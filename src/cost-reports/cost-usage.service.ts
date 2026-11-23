import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThan, Repository } from 'typeorm';
import { toAwsIntegrationError } from '../aws/core/errors/aws-integration.error';
import { dataExportBucket, RESERVED_INSTANCES_USAGE_KEY } from '../aws/data-exports/constants/data-exports.constant';
import { DataExportsService } from '../aws/data-exports/data-exports.service';
import { usageEntries } from '../aws/data-exports/helpers/cur-line.helper';
import { CostExportState, ExportManifest, UsageEntry } from '../aws/data-exports/interfaces/data-export.interface';
import { AwsAccount } from '../aws-accounts/entities/aws-account.entity';
import { addDays, toIsoDate, todayUtc } from '../common/helpers/date.helper';
import { chunk } from '../common/helpers/stats.helper';
import { DAYS_PER_MONTH, USAGE_COST_MIN_DAYS, USAGE_COST_WINDOW_DAYS, USAGE_FLUSH_SIZE, USAGE_INSERT_CHUNK, USAGE_RETENTION_DAYS } from './constants/cost-sync.constant';
import { CostUsageDaily } from './entities/cost-usage-daily.entity';
import { CostUsageSyncResult, DailyUsage } from './interfaces/cost-usage.interface';

@Injectable()
export class CostUsageService {
  private readonly logger = new Logger(CostUsageService.name);

  constructor(
    @InjectRepository(CostUsageDaily) private readonly repo: Repository<CostUsageDaily>,
    private readonly exports: DataExportsService,
  ) {}

  async sync(account: AwsAccount, now = new Date()): Promise<CostUsageSyncResult> {
    const state: CostExportState = {
      status: 'OK',
      bucket: dataExportBucket(account.awsAccountId),
      periods: { ...(account.costExport?.periods ?? {}) },
      lastSyncAt: now.toISOString(),
      error: null,
    };
    const syncedPeriods: string[] = [];
    let rows = 0;
    try {
      const cutoff = toIsoDate(addDays(todayUtc(), -USAGE_RETENTION_DAYS));
      const manifests = (await this.exports.listManifests(account)).filter((m) => m.billingPeriod >= cutoff.slice(0, 7));
      if (manifests.length === 0) state.status = 'WAITING_FIRST_DELIVERY';
      for (const manifest of manifests) {
        if (state.periods[manifest.billingPeriod] === manifest.version) continue;
        rows += await this.replacePeriod(account, manifest, cutoff);
        state.periods[manifest.billingPeriod] = manifest.version;
        syncedPeriods.push(manifest.billingPeriod);
      }
      await this.repo.delete({ awsAccountId: account.id, day: LessThan(cutoff) });
    } catch (error) {
      const err = toAwsIntegrationError(error);
      const missing = err.code === 'ACCESS_DENIED' || err.awsErrorName === 'NoSuchBucket';
      state.status = missing ? 'NOT_CONFIGURED' : 'ERROR';
      state.error = `${err.code}: ${err.message}`.slice(0, 500);
      this.logger.warn({ msg: 'Cost export sync failed', awsAccountRef: account.id, status: state.status, error: state.error });
    }
    this.logger.log({ msg: 'Cost export synced', awsAccountRef: account.id, status: state.status, syncedPeriods, rows });
    return { state, syncedPeriods, rows };
  }

  async coveredDays(awsAccountId: string): Promise<string[]> {
    const rows = await this.repo
      .createQueryBuilder('u')
      .select(`to_char(u.day, 'YYYY-MM-DD')`, 'day')
      .where('u.awsAccountId = :awsAccountId', { awsAccountId })
      .groupBy('u.day')
      .orderBy('u.day', 'ASC')
      .getRawMany<{ day: string }>();
    return rows.map((r) => r.day);
  }

  async dailyUsage(awsAccountId: string, resourceKeys: readonly string[]): Promise<DailyUsage[]> {
    if (resourceKeys.length === 0) return [];
    const rows = await this.repo
      .createQueryBuilder('u')
      .select(`to_char(u.day, 'YYYY-MM-DD')`, 'day')
      .addSelect('SUM(u.cost)', 'cost')
      .addSelect('SUM(u.hours)', 'hours')
      .addSelect('SUM(u.hourlyCost)', 'hourlyCost')
      .where('u.awsAccountId = :awsAccountId', { awsAccountId })
      .andWhere('u.resourceId IN (:...resourceKeys)', { resourceKeys })
      .groupBy('u.day')
      .orderBy('u.day', 'ASC')
      .getRawMany<Record<keyof DailyUsage, string>>();
    return rows.map((r) => ({ day: r.day, cost: Number(r.cost), hours: Number(r.hours), hourlyCost: Number(r.hourlyCost) }));
  }

  async monthlyCostByResource(awsAccountId: string, service: string): Promise<Map<string, number>> {
    const days = (await this.coveredDays(awsAccountId)).slice(-USAGE_COST_WINDOW_DAYS);
    if (days.length < USAGE_COST_MIN_DAYS) return new Map();
    const rows = await this.repo
      .createQueryBuilder('u')
      .select('u.resourceId', 'resourceId')
      .addSelect('SUM(u.cost)', 'cost')
      .where('u.awsAccountId = :awsAccountId', { awsAccountId })
      .andWhere('u.service = :service', { service })
      .andWhere('u.day >= :from', { from: days[0] })
      .andWhere(`u.resourceId <> ''`)
      .groupBy('u.resourceId')
      .getRawMany<{ resourceId: string; cost: string }>();
    return new Map(rows.map((r) => [r.resourceId, (Number(r.cost) / days.length) * DAYS_PER_MONTH]));
  }

  private async replacePeriod(account: AwsAccount, manifest: ExportManifest, cutoff: string): Promise<number> {
    const files = await this.exports.dataFiles(account, manifest);
    return this.repo.manager.transaction(async (manager) => {
      await manager.delete(CostUsageDaily, { awsAccountId: account.id, billingPeriod: manifest.billingPeriod });
      const pending = new Map<string, UsageEntry>();
      const days = new Set<string>();
      const unusedReservations: UsageEntry[] = [];
      let rows = 0;
      for (const file of files) {
        for await (const line of this.exports.readLines(account, file)) {
          if (line.line_item_usage_account_id !== account.awsAccountId) continue;
          for (const entry of usageEntries(line)) {
            if (entry.day < cutoff) continue;
            if (line.line_item_line_item_type === 'RIFee') {
              if (entry.resourceId === RESERVED_INSTANCES_USAGE_KEY) unusedReservations.push(entry);
              continue;
            }
            days.add(entry.day);
            this.accumulate(pending, entry);
          }
          if (pending.size >= USAGE_FLUSH_SIZE) rows += await this.flush(manager, account, manifest.billingPeriod, pending);
        }
      }
      for (const fee of unusedReservations) {
        for (const day of days) this.accumulate(pending, { ...fee, day, cost: fee.cost / days.size });
      }
      rows += await this.flush(manager, account, manifest.billingPeriod, pending);
      return rows;
    });
  }

  private accumulate(pending: Map<string, UsageEntry>, entry: UsageEntry): void {
    const key = `${entry.day}|${entry.service}|${entry.resourceId}`;
    const current = pending.get(key);
    if (!current) {
      pending.set(key, { ...entry });
      return;
    }
    current.cost += entry.cost;
    current.hours += entry.hours;
    current.hourlyCost += entry.hourlyCost;
  }

  private async flush(manager: EntityManager, account: AwsAccount, billingPeriod: string, pending: Map<string, UsageEntry>): Promise<number> {
    const table = 'cost_usage_daily';
    for (const batch of chunk([...pending.values()], USAGE_INSERT_CHUNK)) {
      await manager
        .createQueryBuilder()
        .insert()
        .into(CostUsageDaily)
        .values(batch.map((e) => ({ ...e, awsAccountId: account.id, organizationId: account.organizationId, billingPeriod })))
        .onConflict(
          `("awsAccountId", "billingPeriod", "day", "resourceId", "service") DO UPDATE SET "cost" = ${table}."cost" + EXCLUDED."cost", "hours" = ${table}."hours" + EXCLUDED."hours", "hourlyCost" = ${table}."hourlyCost" + EXCLUDED."hourlyCost"`,
        )
        .execute();
    }
    const rows = pending.size;
    pending.clear();
    return rows;
  }
}
