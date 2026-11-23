import { Injectable, Logger } from '@nestjs/common';
import { forEachRegion } from '../aws/core/helpers/region-runner.helper';
import { CloudWatchService } from '../aws/metrics/cloudwatch.service';
import { DAY, HOUR } from '../aws/metrics/constants/cloudwatch.constant';
import { MetricQuerySpec } from '../aws/metrics/interfaces/ebs-metrics.interface';
import { GIB_BYTES } from '../aws/network/constants/network.constant';
import { PricingService } from '../aws/pricing/pricing.service';
import { AuroraAnalyzerService } from '../aws/rds/aurora-analyzer.service';
import { AURORA_SERVERLESS_CLASS } from '../aws/rds/constants/rds.constant';
import { AuroraCluster, AuroraMember } from '../aws/rds/interfaces/aurora.interface';
import { RdsService } from '../aws/rds/rds.service';
import { AwsAccount } from '../aws-accounts/entities/aws-account.entity';
import { DAYS_PER_MONTH } from '../cost-reports/constants/cost-sync.constant';
import { AURORA_RECOMMENDATION_TYPES } from '../recommendations/constants/recommendation.constant';
import { AURORA_CLUSTER_RESOURCE_TYPE, RDS_DB_INSTANCE_RESOURCE_TYPE } from '../resource-inventory/constants/resource-types.constant';
import { AwsResource } from '../resource-inventory/entities/aws-resource.entity';
import { ResourceInventoryService } from '../resource-inventory/resource-inventory.service';
import { DEFAULT_CURRENCY, METRICS_PERIOD_DAYS } from './constants/scan.constant';
import { ServiceAnalysisDetails, ServiceScanDetails } from './interfaces/scan-report.interface';
import { ServiceAnalysisRunner } from './service-analysis-runner.service';

@Injectable()
export class AuroraScanService {
  private readonly logger = new Logger(AuroraScanService.name);

  constructor(
    private readonly inventory: ResourceInventoryService,
    private readonly rds: RdsService,
    private readonly cloudWatch: CloudWatchService,
    private readonly pricing: PricingService,
    private readonly analyzer: AuroraAnalyzerService,
    private readonly runner: ServiceAnalysisRunner,
  ) {}

  async scan(account: AwsAccount, regions: readonly string[], seenAt: Date): Promise<ServiceScanDetails> {
    const unavailable = new Set<string>();
    const instances = new Map((await this.inventory.findByType(account.id, RDS_DB_INSTANCE_RESOURCE_TYPE)).map((r) => [`${r.region}|${r.resourceId}`, r]));
    const run = await forEachRegion([...regions], async (region) => {
      const instancesUnreadable = [...instances.values()].some((r) => r.region === region && r.metadata.unreadableSince);
      const clusters = instancesUnreadable ? null : await this.runner.readable(account, 'DescribeDBClusters', unavailable, () => this.rds.listAuroraClusters(account, region));
      if (clusters === null) {
        await this.inventory.markUnreadable(account.id, AURORA_CLUSTER_RESOURCE_TYPE, seenAt, region);
        return 0;
      }
      await this.enrichRegion(account, region, clusters, instances, seenAt);
      return clusters.length;
    });
    return { resources: run.results.reduce((s, r) => s + r.value, 0), unavailable: [...unavailable], failures: run.failures };
  }

  analyze(account: AwsAccount): Promise<ServiceAnalysisDetails> {
    return this.runner.analyze(
      account,
      AURORA_CLUSTER_RESOURCE_TYPE,
      AURORA_RECOMMENDATION_TYPES,
      (r) => (r.metadata.auroraCluster ? this.analyzer.analyze({ ...r.metadata.auroraCluster, environmentOverride: r.environment, currency: DEFAULT_CURRENCY }) : null),
      (r) => r.metadata.auroraCluster?.members.map((m) => m.dbInstanceId) ?? [],
    );
  }

  private async enrichRegion(account: AwsAccount, region: string, clusters: AuroraCluster[], instances: ReadonlyMap<string, AwsResource>, seenAt: Date): Promise<void> {
    if (clusters.length === 0) return;
    const series = await this.cloudWatch.getMetricSeries(account, region, this.queries(clusters, region, instances), METRICS_PERIOD_DAYS);
    await this.inventory.upsertDiscovered(
      account,
      clusters.map((c) => ({ arn: c.arn, resourceId: c.arn, service: 'rds', resourceType: AURORA_CLUSTER_RESOURCE_TYPE, region, name: c.clusterId, tags: c.tags })),
      seenAt,
    );
    for (const cluster of clusters) {
      const members = cluster.members.flatMap((m): AuroraMember[] => {
        const resource = instances.get(`${region}|${m.dbInstanceId}`);
        const db = resource?.metadata.rds;
        if (!db) return [];
        return [{ ...m, arn: db.arn, instanceClass: db.instanceClass, status: db.status, metrics: resource.metadata.rdsMetrics ?? null, capacity: series.get(`i:${m.dbInstanceId}`)?.capacity ?? null }];
      });
      const classes = members.map((m) => m.instanceClass).filter((c) => c !== AURORA_SERVERLESS_CLASS);
      const prices = await this.pricing.getAuroraPrices(region, cluster.engine, classes);
      const own = series.get(`c:${cluster.clusterId}`);
      const storage = own?.storage?.values ?? [];
      const io = [own?.readIo?.values, own?.writeIo?.values].map((v) => (v?.length ? { total: v.reduce((a, b) => a + b, 0), days: v.length } : null));
      const ioMonthly = io.every((v) => v === null) ? null : io.reduce((sum, v) => sum + (v ? (v.total / v.days) * DAYS_PER_MONTH : 0), 0);
      await this.inventory.patchMetadata(account.id, AURORA_CLUSTER_RESOURCE_TYPE, cluster.arn, {
        tags: cluster.tags,
        unreadableSince: null,
        auroraCluster: {
          cluster,
          members,
          usage: { periodDays: METRICS_PERIOD_DAYS, storageGb: storage.length ? storage[storage.length - 1] / GIB_BYTES : null, monthlyIoRequests: ioMonthly },
          prices,
        },
      });
      const byClass = (cluster.ioOptimized ? prices.ioOptimized : prices.standard).byClass;
      for (const m of members) {
        const current = instances.get(`${region}|${m.dbInstanceId}`)?.metadata.rdsPrices;
        await this.inventory.patchMetadata(account.id, RDS_DB_INSTANCE_RESOURCE_TYPE, m.dbInstanceId, {
          rdsPrices: { deployment: 'Single-AZ', singleAz: null, publicIpv4Monthly: current?.publicIpv4Monthly ?? null, byClass, auroraIoOptimized: cluster.ioOptimized },
        });
      }
    }
    this.logger.log({ msg: 'Aurora region enriched', awsAccountRef: account.id, region, clusters: clusters.length });
  }

  private queries(clusters: AuroraCluster[], region: string, instances: ReadonlyMap<string, AwsResource>): MetricQuerySpec<'storage' | 'readIo' | 'writeIo' | 'capacity'>[] {
    return clusters.flatMap((c) => {
      const cluster = { ownerId: `c:${c.clusterId}`, namespace: 'AWS/RDS', dimensions: [{ Name: 'DBClusterIdentifier', Value: c.clusterId }], period: DAY };
      return [
        { ...cluster, kind: 'storage' as const, metricName: 'VolumeBytesUsed', stat: 'Average' },
        { ...cluster, kind: 'readIo' as const, metricName: 'VolumeReadIOPs', stat: 'Sum' },
        { ...cluster, kind: 'writeIo' as const, metricName: 'VolumeWriteIOPs', stat: 'Sum' },
        ...c.members
          .filter((m) => instances.get(`${region}|${m.dbInstanceId}`)?.metadata.rds?.instanceClass === AURORA_SERVERLESS_CLASS)
          .map((m) => ({
            ownerId: `i:${m.dbInstanceId}`,
            namespace: 'AWS/RDS',
            dimensions: [{ Name: 'DBInstanceIdentifier', Value: m.dbInstanceId }],
            period: HOUR,
            kind: 'capacity' as const,
            metricName: 'ServerlessDatabaseCapacity',
            stat: 'Average',
          })),
      ];
    });
  }
}
