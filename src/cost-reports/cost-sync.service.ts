import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { CostExplorerService } from '../aws/costs/cost-explorer.service';
import { CostLine } from '../aws/costs/interfaces/cost-line.interface';
import { toAwsIntegrationError } from '../aws/core/errors/aws-integration.error';
import { AwsAccountRef } from '../aws/core/interfaces/aws-account-ref.interface';
import { CostGranularity, CostKind } from '../common/enums';
import { addDays, startOfMonth, toIsoDate, todayUtc } from '../common/helpers/date.helper';
import { DAILY_HISTORY_DAYS, MONTHLY_HISTORY_MONTHS, RESOURCE_LEVEL_DAYS } from './constants/cost-sync.constant';
import { CostSnapshot } from './entities/cost-snapshot.entity';
import { CostSyncSummary } from './interfaces/cost-report.interface';

@Injectable()
export class CostSyncService {
  private readonly logger = new Logger(CostSyncService.name);

  constructor(
    @InjectRepository(CostSnapshot) private readonly repo: Repository<CostSnapshot>,
    private readonly costExplorer: CostExplorerService,
  ) {}

  async syncAccount(account: AwsAccountRef): Promise<CostSyncSummary> {
    const today = todayUtc();
    const end = toIsoDate(today);
    const monthlyStart = toIsoDate(startOfMonth(today, -(MONTHLY_HISTORY_MONTHS - 1)));
    const dailyStart = toIsoDate(addDays(today, -DAILY_HISTORY_DAYS));
    const resourceStart = toIsoDate(addDays(today, -(RESOURCE_LEVEL_DAYS - 1)));

    const monthly = monthlyStart < end ? await this.costExplorer.getCostByService(account, monthlyStart, end, 'MONTHLY') : [];
    const daily = await this.costExplorer.getCostByService(account, dailyStart, end, 'DAILY');

    let resources: CostLine[] = [];
    let resourceLevelAvailable = true;
    try {
      resources = await this.costExplorer.getCostByResource(account, resourceStart, end);
    } catch (error) {
      resourceLevelAvailable = false;
      const err = toAwsIntegrationError(error);
      this.logger.warn({ msg: 'Resource-level cost data unavailable', awsAccountRef: account.id, code: err.code, error: err.message });
    }

    const forecastEnd = toIsoDate(startOfMonth(today, 1));
    const forecast = await this.costExplorer.getForecast(account, end, forecastEnd);

    await this.repo.manager.transaction(async (manager) => {
      await this.replace(manager, account, CostGranularity.MONTHLY, CostKind.ACTUAL, monthlyStart, 'service', monthly);
      await this.replace(manager, account, CostGranularity.DAILY, CostKind.ACTUAL, dailyStart, 'service', daily);
      if (resourceLevelAvailable) {
        await this.replace(manager, account, CostGranularity.DAILY, CostKind.ACTUAL, resourceStart, 'resource', resources);
      }
      await manager.delete(CostSnapshot, { awsAccountId: account.id, kind: CostKind.FORECAST });
      if (forecast) {
        await manager.insert(CostSnapshot, {
          organizationId: account.organizationId,
          awsAccountId: account.id,
          service: null,
          resourceId: null,
          amount: forecast.amount,
          currency: forecast.currency,
          granularity: CostGranularity.MONTHLY,
          kind: CostKind.FORECAST,
          periodStart: forecast.periodStart,
          periodEnd: forecast.periodEnd,
        });
      }
    });

    const summary: CostSyncSummary = {
      monthlyLines: monthly.length,
      dailyLines: daily.length,
      resourceLines: resources.length,
      resourceLevelAvailable,
      forecastAvailable: forecast !== null,
    };
    this.logger.log({ msg: 'Cost sync finished', awsAccountRef: account.id, organizationId: account.organizationId, ...summary });
    return summary;
  }

  private async replace(
    manager: EntityManager,
    account: AwsAccountRef,
    granularity: CostGranularity,
    kind: CostKind,
    fromDate: string,
    level: 'service' | 'resource',
    lines: CostLine[],
  ): Promise<void> {
    await manager.delete(CostSnapshot, {
      awsAccountId: account.id,
      granularity,
      kind,
      periodStart: MoreThanOrEqual(fromDate),
      resourceId: level === 'resource' ? Not(IsNull()) : IsNull(),
    });
    if (lines.length === 0) return;
    await manager
      .createQueryBuilder()
      .insert()
      .into(CostSnapshot)
      .values(
        lines.map((l) => ({
          organizationId: account.organizationId,
          awsAccountId: account.id,
          service: l.service,
          resourceId: l.resourceId,
          amount: l.amount,
          currency: l.currency,
          granularity,
          kind,
          periodStart: l.periodStart,
          periodEnd: l.periodEnd,
        })),
      )
      .execute();
  }
}
