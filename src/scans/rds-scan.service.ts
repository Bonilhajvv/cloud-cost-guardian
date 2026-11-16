import { Injectable, Logger } from '@nestjs/common';
import { toAwsIntegrationError } from '../aws/core/errors/aws-integration.error';
import { forEachRegion } from '../aws/core/helpers/region-runner.helper';
import { RecommendationDraft, ResourceAnalysis } from '../aws/core/interfaces/recommendation-draft.interface';
import { CloudWatchService } from '../aws/metrics/cloudwatch.service';
import { ComputeOptimizerService } from '../aws/optimizer/compute-optimizer.service';
import { PricingService } from '../aws/pricing/pricing.service';
import { extendedSupportYear, inExtendedSupport, lifecycleFor } from '../aws/rds/helpers/rds-lifecycle.helper';
import { RdsEngineLifecycle } from '../aws/rds/interfaces/rds-instance.interface';
import { RdsAnalyzerService } from '../aws/rds/rds-analyzer.service';
import { RdsService } from '../aws/rds/rds.service';
import { AwsAccount } from '../aws-accounts/entities/aws-account.entity';
import { RDS_RECOMMENDATION_TYPES } from '../recommendations/constants/recommendation.constant';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { RDS_DB_INSTANCE_RESOURCE_TYPE } from '../resource-inventory/constants/resource-types.constant';
import { rdsToResourceData } from '../resource-inventory/helpers/rds-to-resource-data.helper';
import { ResourceInventoryService } from '../resource-inventory/resource-inventory.service';
import { DEFAULT_CURRENCY, METRICS_PERIOD_DAYS } from './constants/scan.constant';
import { groupByRegion } from './helpers/group-by-region.helper';
import { AnalysisDetails, OptimizerSyncDetails, RdsScanDetails } from './interfaces/scan-report.interface';

@Injectable()
export class RdsScanService {
  private readonly logger = new Logger(RdsScanService.name);

  constructor(
    private readonly inventory: ResourceInventoryService,
    private readonly rds: RdsService,
    private readonly analyzer: RdsAnalyzerService,
    private readonly cloudWatch: CloudWatchService,
    private readonly optimizer: ComputeOptimizerService,
    private readonly pricing: PricingService,
    private readonly recommendations: RecommendationsService,
  ) {}

  async scan(account: AwsAccount, regions: readonly string[], seenAt: Date): Promise<RdsScanDetails> {
    const run = await forEachRegion([...regions], (region) => this.enrichRegion(account, region, seenAt));
    return { databases: run.results.reduce((s, r) => s + r.value, 0), failures: run.failures };
  }

  async syncOptimizer(account: AwsAccount): Promise<Omit<OptimizerSyncDetails, 'rds'>> {
    const resources = await this.inventory.findByType(account.id, RDS_DB_INSTANCE_RESOURCE_TYPE);
    const byRegion = groupByRegion(resources, (r) => r.region);
    const regions: Record<string, string> = {};
    let total = 0;
    const run = await forEachRegion([...byRegion.keys()], async (region) => {
      const result = await this.optimizer.getRdsRecommendations(account, region);
      regions[region] = result.availability;
      const byId = new Map(result.recommendations.map((r) => [r.dbInstanceId, r]));
      for (const resource of byRegion.get(region) ?? []) {
        const rec = byId.get(resource.resourceId) ?? null;
        const db = resource.metadata.rds;
        const prices = resource.metadata.rdsPrices;
        if (rec && db && prices) {
          const options = await this.pricing.getRdsInstancePrices(region, db.engine, prices.deployment, rec.options.map((o) => o.instanceClass));
          prices.byClass = { ...prices.byClass, ...options };
        }
        await this.inventory.patchMetadata(account.id, resource.resourceType, resource.resourceId, { rdsOptimizer: rec, ...(prices ? { rdsPrices: prices } : {}) });
      }
      total += result.recommendations.length;
    });
    return { regions, recommendations: total, failures: run.failures };
  }

  async analyze(account: AwsAccount): Promise<Omit<AnalysisDetails, 'ebs' | 'rds'>> {
    const resources = await this.inventory.findByType(account.id, RDS_DB_INSTANCE_RESOURCE_TYPE);
    const drafts: RecommendationDraft[] = [];
    const analyses = new Map<string, ResourceAnalysis>();
    const findings: Record<string, number> = {};
    let analyzed = 0;
    for (const resource of resources) {
      const m = resource.metadata;
      if (!m.rds) continue;
      const result = this.analyzer.analyze({
        instance: m.rds,
        metrics: m.rdsMetrics ?? null,
        optimizer: m.rdsOptimizer ?? null,
        prices: m.rdsPrices ?? null,
        lifecycle: m.rdsLifecycle ?? null,
        extendedSupportHourlyPerVcpu: m.rdsExtendedSupportHourlyPerVcpu ?? null,
        currency: DEFAULT_CURRENCY,
      });
      await this.inventory.patchMetadata(account.id, resource.resourceType, resource.resourceId, { analysis: result.analysis });
      analyses.set(resource.resourceId, result.analysis);
      findings[result.analysis.finding] = (findings[result.analysis.finding] ?? 0) + 1;
      drafts.push(...result.drafts);
      analyzed++;
    }
    const sync = await this.recommendations.syncDrafts(account, RDS_RECOMMENDATION_TYPES, drafts, analyses);
    this.logger.log({ msg: 'RDS analysis finished', awsAccountRef: account.id, analyzed, findings, drafts: drafts.length });
    return { analyzed, findings, ...sync };
  }

  private async enrichRegion(account: AwsAccount, region: string, seenAt: Date): Promise<number> {
    let databases;
    try {
      databases = await this.rds.listInstances(account, region);
    } catch (error) {
      const err = toAwsIntegrationError(error);
      if (err.code !== 'ACCESS_DENIED') throw err;
      this.logger.warn({ msg: 'RDS not readable: update the read-only role with rds:DescribeDBInstances', awsAccountRef: account.id, region });
      return 0;
    }
    if (databases.length === 0) return 0;
    await this.inventory.upsertDiscovered(account, databases.map(rdsToResourceData), seenAt);
    const metrics = await this.cloudWatch.getRdsUtilization(account, region, databases.map((d) => d.dbInstanceId), METRICS_PERIOD_DAYS);
    const lifecycles = await this.lifecycles(account, region, databases.map((d) => d.engine));
    const now = new Date();
    for (const db of databases) {
      const lifecycle = lifecycleFor(db.engine, db.engineVersion, lifecycles);
      const deployment = db.multiAz ? 'Multi-AZ' : 'Single-AZ';
      const byClass = await this.pricing.getRdsInstancePrices(region, db.engine, deployment, [db.instanceClass]);
      const singleAz = db.multiAz ? ((await this.pricing.getRdsInstancePrices(region, db.engine, 'Single-AZ', [db.instanceClass]))[db.instanceClass] ?? null) : null;
      const extendedSupport =
        lifecycle && inExtendedSupport(lifecycle, now)
          ? await this.pricing.getRdsExtendedSupportHourlyPerVcpu(region, db.engine, lifecycle.majorVersion, extendedSupportYear(lifecycle, now))
          : null;
      await this.inventory.patchMetadata(account.id, RDS_DB_INSTANCE_RESOURCE_TYPE, db.dbInstanceId, {
        rds: db,
        tags: db.tags,
        rdsMetrics: metrics.get(db.dbInstanceId) ?? null,
        rdsPrices: { deployment, byClass, singleAz },
        rdsLifecycle: lifecycle,
        rdsExtendedSupportHourlyPerVcpu: extendedSupport,
      });
    }
    this.logger.log({ msg: 'RDS region enriched', awsAccountRef: account.id, region, databases: databases.length });
    return databases.length;
  }

  private async lifecycles(account: AwsAccount, region: string, engines: string[]): Promise<RdsEngineLifecycle[]> {
    try {
      return await this.rds.engineLifecycles(account, region, engines);
    } catch (error) {
      const err = toAwsIntegrationError(error);
      this.logger.warn({ msg: 'RDS engine lifecycle unavailable: Extended Support not evaluated', awsAccountRef: account.id, region, code: err.code });
      return [];
    }
  }
}
