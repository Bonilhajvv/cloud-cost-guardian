import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { CostGranularity, CostKind } from '../common/enums';
import { addDays, daysInMonth, startOfMonth, toIsoDate, todayUtc } from '../common/helpers/date.helper';
import { round } from '../common/helpers/stats.helper';
import { DAYS_PER_MONTH, RESOURCE_LEVEL_DAYS } from './constants/cost-sync.constant';
import { CostSnapshot } from './entities/cost-snapshot.entity';
import {
  CostSummary,
  DailyCost,
  MonthlyCost,
  ProjectionMethod,
  ResourceCost,
  ServiceCost,
} from './interfaces/cost-report.interface';

@Injectable()
export class CostReportsService {
  constructor(@InjectRepository(CostSnapshot) private readonly repo: Repository<CostSnapshot>) {}

  async summary(organizationId: string, awsAccountId?: string): Promise<CostSummary> {
    const today = todayUtc();
    const monthStart = toIsoDate(startOfMonth(today));
    const prevMonthStart = toIsoDate(startOfMonth(today, -1));

    const byService = await this.serviceTotals(organizationId, monthStart, awsAccountId);
    const monthToDate = round(byService.reduce((s, r) => s + r.amount, 0));
    const previousMonthTotal = round(
      (await this.serviceTotals(organizationId, prevMonthStart, awsAccountId)).reduce((s, r) => s + r.amount, 0),
    );

    const forecastRow = await this.base(organizationId, awsAccountId)
      .select('SUM(c.amount)', 'amount')
      .andWhere('c.kind = :kind', { kind: CostKind.FORECAST })
      .getRawOne<{ amount: string | null }>();
    const forecast = forecastRow?.amount === null || forecastRow?.amount === undefined ? null : Number(forecastRow.amount);

    let projectionMethod: ProjectionMethod = 'NONE';
    let projectedMonthTotal: number | null = null;
    const daysElapsed = today.getUTCDate() - 1;
    if (forecast !== null) {
      projectionMethod = 'AWS_FORECAST';
      projectedMonthTotal = round(monthToDate + forecast);
    } else if (daysElapsed > 0 && monthToDate > 0) {
      projectionMethod = 'LINEAR';
      projectedMonthTotal = round((monthToDate / daysElapsed) * daysInMonth(today));
    }

    const comparable = projectedMonthTotal ?? monthToDate;
    return {
      currency: await this.currency(organizationId),
      monthStart,
      monthToDate,
      projectedMonthTotal,
      projectionMethod,
      previousMonthTotal,
      variationPercent:
        previousMonthTotal > 0 ? round(((comparable - previousMonthTotal) / previousMonthTotal) * 100) : null,
      byService,
    };
  }

  async daily(organizationId: string, days: number, awsAccountId?: string): Promise<DailyCost[]> {
    const from = toIsoDate(addDays(todayUtc(), -days));
    const rows = await this.base(organizationId, awsAccountId)
      .select(`to_char(c.periodStart, 'YYYY-MM-DD')`, 'date')
      .addSelect('SUM(c.amount)', 'amount')
      .andWhere('c.granularity = :g', { g: CostGranularity.DAILY })
      .andWhere('c.kind = :k', { k: CostKind.ACTUAL })
      .andWhere('c.resourceId IS NULL')
      .andWhere('c.periodStart >= :from', { from })
      .groupBy('c.periodStart')
      .orderBy('c.periodStart', 'ASC')
      .getRawMany<{ date: string; amount: string }>();
    return rows.map((r) => ({ date: r.date, amount: round(Number(r.amount)) }));
  }

  async trend(organizationId: string, months: number, awsAccountId?: string): Promise<MonthlyCost[]> {
    const from = toIsoDate(startOfMonth(todayUtc(), -(months - 1)));
    const rows = await this.base(organizationId, awsAccountId)
      .select(`to_char(c.periodStart, 'YYYY-MM')`, 'month')
      .addSelect('SUM(c.amount)', 'amount')
      .andWhere('c.granularity = :g', { g: CostGranularity.MONTHLY })
      .andWhere('c.kind = :k', { k: CostKind.ACTUAL })
      .andWhere('c.resourceId IS NULL')
      .andWhere('c.periodStart >= :from', { from })
      .groupBy('c.periodStart')
      .orderBy('c.periodStart', 'ASC')
      .getRawMany<{ month: string; amount: string }>();
    return rows.map((r) => ({ month: r.month, amount: round(Number(r.amount)) }));
  }

  async byResource(organizationId: string, limit: number, awsAccountId?: string): Promise<ResourceCost[]> {
    const rows = await this.resourceQuery(this.base(organizationId, awsAccountId))
      .orderBy('SUM(c.amount)', 'DESC')
      .limit(limit)
      .getRawMany<{ awsAccountId: string; resourceId: string; service: string | null; amount: string; days: string }>();
    return rows.map((r) => ({
      awsAccountId: r.awsAccountId,
      resourceId: r.resourceId,
      service: r.service,
      last14DaysAmount: round(Number(r.amount)),
      estimatedMonthlyCost: round((Number(r.amount) / Number(r.days)) * DAYS_PER_MONTH),
    }));
  }

  async monthlyEstimatesByResource(awsAccountId: string): Promise<Map<string, number>> {
    const qb = this.repo.createQueryBuilder('c').where('c.awsAccountId = :awsAccountId', { awsAccountId });
    const rows = await this.resourceQuery(qb).getRawMany<{ resourceId: string; amount: string; days: string }>();
    return new Map(rows.map((r) => [r.resourceId, (Number(r.amount) / Number(r.days)) * DAYS_PER_MONTH]));
  }

  async totalMonthToDate(): Promise<{ amount: number; currency: string }> {
    const row = await this.repo
      .createQueryBuilder('c')
      .select('SUM(c.amount)', 'amount')
      .where('c.granularity = :g AND c.kind = :k AND c.resourceId IS NULL AND c.periodStart = :m', {
        g: CostGranularity.MONTHLY,
        k: CostKind.ACTUAL,
        m: toIsoDate(startOfMonth(todayUtc())),
      })
      .getRawOne<{ amount: string | null }>();
    return { amount: round(Number(row?.amount ?? 0)), currency: 'USD' };
  }

  private resourceQuery(qb: SelectQueryBuilder<CostSnapshot>): SelectQueryBuilder<CostSnapshot> {
    const from = toIsoDate(addDays(todayUtc(), -RESOURCE_LEVEL_DAYS));
    return qb
      .select('c.awsAccountId', 'awsAccountId')
      .addSelect('c.resourceId', 'resourceId')
      .addSelect('MAX(c.service)', 'service')
      .addSelect('SUM(c.amount)', 'amount')
      .addSelect('COUNT(DISTINCT c.periodStart)', 'days')
      .andWhere('c.granularity = :rg', { rg: CostGranularity.DAILY })
      .andWhere('c.kind = :rk', { rk: CostKind.ACTUAL })
      .andWhere('c.resourceId IS NOT NULL')
      .andWhere('c.periodStart >= :rfrom', { rfrom: from })
      .groupBy('c.awsAccountId')
      .addGroupBy('c.resourceId');
  }

  private async serviceTotals(organizationId: string, monthStart: string, awsAccountId?: string): Promise<ServiceCost[]> {
    const rows = await this.base(organizationId, awsAccountId)
      .select('c.service', 'service')
      .addSelect('SUM(c.amount)', 'amount')
      .andWhere('c.granularity = :g', { g: CostGranularity.MONTHLY })
      .andWhere('c.kind = :k', { k: CostKind.ACTUAL })
      .andWhere('c.resourceId IS NULL')
      .andWhere('c.periodStart = :monthStart', { monthStart })
      .groupBy('c.service')
      .orderBy('SUM(c.amount)', 'DESC')
      .getRawMany<{ service: string | null; amount: string }>();
    return rows.map((r) => ({ service: r.service ?? 'Unknown', amount: round(Number(r.amount)) }));
  }

  private async currency(organizationId: string): Promise<string> {
    const row = await this.repo.findOne({ where: { organizationId }, select: { currency: true } });
    return row?.currency ?? 'USD';
  }

  private base(organizationId: string, awsAccountId?: string): SelectQueryBuilder<CostSnapshot> {
    const qb = this.repo.createQueryBuilder('c').where('c.organizationId = :organizationId', { organizationId });
    if (awsAccountId) qb.andWhere('c.awsAccountId = :awsAccountId', { awsAccountId });
    return qb;
  }
}
