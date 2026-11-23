import { Injectable, Logger } from '@nestjs/common';
import { forEachRegion } from '../aws/core/helpers/region-runner.helper';
import { CloudWatchService } from '../aws/metrics/cloudwatch.service';
import { DAY } from '../aws/metrics/constants/cloudwatch.constant';
import { MetricQuerySpec } from '../aws/metrics/interfaces/ebs-metrics.interface';
import { GIB_BYTES } from '../aws/network/constants/network.constant';
import { PricingService } from '../aws/pricing/pricing.service';
import { S3_METRICS_DAYS, S3_STORAGE_TYPES } from '../aws/s3/constants/s3.constant';
import { S3Bucket } from '../aws/s3/interfaces/s3.interface';
import { S3AnalyzerService } from '../aws/s3/s3-analyzer.service';
import { S3Service } from '../aws/s3/s3.service';
import { toAwsIntegrationError } from '../aws/core/errors/aws-integration.error';
import { AwsAccount } from '../aws-accounts/entities/aws-account.entity';
import { CostUsageService } from '../cost-reports/cost-usage.service';
import { S3_RECOMMENDATION_TYPES } from '../recommendations/constants/recommendation.constant';
import { S3_BUCKET_RESOURCE_TYPE } from '../resource-inventory/constants/resource-types.constant';
import { ResourceInventoryService } from '../resource-inventory/resource-inventory.service';
import { DEFAULT_CURRENCY } from './constants/scan.constant';
import { groupByRegion } from './helpers/group-by-region.helper';
import { ServiceAnalysisDetails, ServiceScanDetails } from './interfaces/scan-report.interface';
import { ServiceAnalysisRunner } from './service-analysis-runner.service';

@Injectable()
export class S3ScanService {
  private readonly logger = new Logger(S3ScanService.name);

  constructor(
    private readonly inventory: ResourceInventoryService,
    private readonly s3: S3Service,
    private readonly cloudWatch: CloudWatchService,
    private readonly pricing: PricingService,
    private readonly analyzer: S3AnalyzerService,
    private readonly usage: CostUsageService,
    private readonly runner: ServiceAnalysisRunner,
  ) {}

  async scan(account: AwsAccount, seenAt: Date): Promise<ServiceScanDetails> {
    const unavailable = new Set<string>();
    try {
      const names = await this.runner.readable(account, 'ListBuckets', unavailable, () => this.s3.listBuckets(account));
      if (names === null) {
        await this.inventory.markUnreadable(account.id, S3_BUCKET_RESOURCE_TYPE, seenAt);
        return { resources: 0, unavailable: [...unavailable], failures: [] };
      }
      const { buckets, unreadable } = await this.s3.describeBuckets(account, names, seenAt);
      if (unreadable.length) {
        unavailable.add('DescribeBucket');
        this.logger.warn({ msg: 'S3 buckets not readable: update the read-only role or the bucket policy', awsAccountRef: account.id, buckets: unreadable.length });
        await this.inventory.markUnreadable(account.id, S3_BUCKET_RESOURCE_TYPE, seenAt);
      }
      const byRegion = groupByRegion(buckets, (b) => b.region);
      const run = await forEachRegion([...byRegion.keys()], (region) => this.enrichRegion(account, region, byRegion.get(region) ?? [], seenAt));
      return { resources: buckets.length, unavailable: [...unavailable], failures: run.failures };
    } catch (error) {
      const err = toAwsIntegrationError(error);
      return { resources: 0, unavailable: [...unavailable], failures: [{ region: 'global', code: err.code, message: err.message }] };
    }
  }

  async analyze(account: AwsAccount): Promise<ServiceAnalysisDetails> {
    const costs = await this.usage.monthlyCostByResource(account.id, 'AmazonS3');
    return this.runner.analyze(account, S3_BUCKET_RESOURCE_TYPE, S3_RECOMMENDATION_TYPES, (r) =>
      r.metadata.s3Bucket
        ? this.analyzer.analyze({ ...r.metadata.s3Bucket, measuredMonthlyCost: costs.get(r.metadata.s3Bucket.bucket.name) ?? null, currency: DEFAULT_CURRENCY })
        : null,
    );
  }

  private async enrichRegion(account: AwsAccount, region: string, buckets: S3Bucket[], seenAt: Date): Promise<number> {
    const kinds = Object.keys(S3_STORAGE_TYPES);
    const specs: MetricQuerySpec<string>[] = buckets.flatMap((b) => {
      const size = (kind: string, metricName: string, storageType: string) => ({
        ownerId: b.name,
        kind,
        namespace: 'AWS/S3',
        metricName,
        dimensions: [
          { Name: 'BucketName', Value: b.name },
          { Name: 'StorageType', Value: storageType },
        ],
        stat: 'Average',
        period: DAY,
      });
      return [...kinds.map((k) => size(k, 'BucketSizeBytes', S3_STORAGE_TYPES[k])), size('objects', 'NumberOfObjects', 'AllStorageTypes')];
    });
    const series = await this.cloudWatch.getMetricSeries(account, region, specs, S3_METRICS_DAYS);
    const prices = await this.pricing.getS3StoragePrices(region);
    const tags = new Map((await this.inventory.findByType(account.id, S3_BUCKET_RESOURCE_TYPE)).map((r) => [r.arn, r.metadata.tags ?? {}]));
    await this.inventory.upsertDiscovered(
      account,
      buckets.map((b) => ({ arn: b.arn, resourceId: b.name, service: 's3', resourceType: S3_BUCKET_RESOURCE_TYPE, region, name: b.name, tags: tags.get(b.arn) ?? {} })),
      seenAt,
    );
    for (const bucket of buckets) {
      const own = series.get(bucket.name) ?? {};
      const last = (kind: string): number | null => own[kind]?.values.at(-1) ?? null;
      const storageGb = Object.fromEntries(kinds.flatMap((k) => (last(k) === null ? [] : [[k, (last(k) as number) / GIB_BYTES] as const])));
      await this.inventory.patchMetadata(account.id, S3_BUCKET_RESOURCE_TYPE, bucket.name, { unreadableSince: null, s3Bucket: { bucket, storageGb, objects: last('objects'), prices } });
    }
    this.logger.log({ msg: 'S3 region enriched', awsAccountRef: account.id, region, buckets: buckets.length });
    return buckets.length;
  }
}
