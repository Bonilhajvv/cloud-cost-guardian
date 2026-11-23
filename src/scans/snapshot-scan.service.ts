import { Injectable, Logger } from '@nestjs/common';
import { toAwsIntegrationError } from '../aws/core/errors/aws-integration.error';
import { forEachRegion } from '../aws/core/helpers/region-runner.helper';
import { RecommendationDraft, ResourceAnalysis } from '../aws/core/interfaces/recommendation-draft.interface';
import { PricingService } from '../aws/pricing/pricing.service';
import { AwsResourceData } from '../aws/resources/interfaces/aws-resource-data.interface';
import { SnapshotResource } from '../aws/snapshots/interfaces/snapshot.interface';
import { SnapshotAnalyzerService } from '../aws/snapshots/snapshot-analyzer.service';
import { SnapshotsService } from '../aws/snapshots/snapshots.service';
import { AwsAccount } from '../aws-accounts/entities/aws-account.entity';
import { SNAPSHOT_RECOMMENDATION_TYPES } from '../recommendations/constants/recommendation.constant';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { EBS_VOLUME_RESOURCE_TYPE, RDS_DB_INSTANCE_RESOURCE_TYPE, SNAPSHOT_RESOURCE_TYPES } from '../resource-inventory/constants/resource-types.constant';
import { ResourceInventoryService } from '../resource-inventory/resource-inventory.service';
import { DEFAULT_CURRENCY } from './constants/scan.constant';
import { AnalysisDetails, SnapshotScanDetails } from './interfaces/scan-report.interface';

type Kind = keyof typeof SNAPSHOT_RESOURCE_TYPES;

@Injectable()
export class SnapshotScanService {
  private readonly logger = new Logger(SnapshotScanService.name);

  constructor(
    private readonly inventory: ResourceInventoryService,
    private readonly snapshots: SnapshotsService,
    private readonly analyzer: SnapshotAnalyzerService,
    private readonly pricing: PricingService,
    private readonly recommendations: RecommendationsService,
  ) {}

  async scan(account: AwsAccount, regions: readonly string[], seenAt: Date): Promise<SnapshotScanDetails> {
    const unavailable = new Map<string, Kind>();
    const run = await forEachRegion([...regions], (region) => this.scanRegion(account, region, seenAt, unavailable));
    for (const kind of new Set(unavailable.values())) await this.inventory.markUnreadable(account.id, SNAPSHOT_RESOURCE_TYPES[kind], seenAt);
    return {
      ebsSnapshots: run.results.reduce((s, r) => s + r.value.ebs, 0),
      rdsSnapshots: run.results.reduce((s, r) => s + r.value.rds, 0),
      unavailable: [...unavailable.keys()],
      failures: run.failures,
    };
  }

  async analyze(account: AwsAccount): Promise<Omit<AnalysisDetails, 'ebs' | 'rds' | 'network' | 'snapshots'>> {
    const volumeIds = new Set((await this.inventory.findByType(account.id, EBS_VOLUME_RESOURCE_TYPE)).map((r) => r.resourceId));
    const databaseIds = new Set((await this.inventory.findByType(account.id, RDS_DB_INSTANCE_RESOURCE_TYPE)).map((r) => r.resourceId));
    const resources = [
      ...(await this.inventory.findByType(account.id, SNAPSHOT_RESOURCE_TYPES.EBS)),
      ...(await this.inventory.findByType(account.id, SNAPSHOT_RESOURCE_TYPES.RDS)),
    ].filter((r) => r.metadata.snapshot);
    const perSource = new Map<string, number>();
    for (const r of resources) {
      const source = sourceOf(r.metadata.snapshot as SnapshotResource);
      if (source) perSource.set(source, (perSource.get(source) ?? 0) + 1);
    }

    const drafts: RecommendationDraft[] = [];
    const analyses = new Map<string, ResourceAnalysis>();
    const findings: Record<string, number> = {};
    const unreadable = new Set(resources.filter((r) => r.metadata.unreadableSince).map((r) => r.resourceId));
    for (const resource of resources) {
      if (unreadable.has(resource.resourceId)) continue;
      const snapshot = resource.metadata.snapshot as SnapshotResource;
      const source = sourceOf(snapshot);
      const { analysis, draft } = this.analyzer.analyze({
        resourceId: resource.resourceId,
        resourceArn: resource.arn,
        resource: snapshot,
        pricePerGbMonth: resource.metadata.snapshotPricePerGbMonth ?? null,
        sourceExists: source === null || (snapshot.kind === 'EBS_SNAPSHOT' ? volumeIds : databaseIds).has(source.slice(source.indexOf(':') + 1)),
        otherSnapshotsOfSource: source === null ? 0 : (perSource.get(source) ?? 1) - 1,
        currency: DEFAULT_CURRENCY,
      });
      await this.inventory.patchMetadata(account.id, resource.resourceType, resource.resourceId, { analysis });
      analyses.set(resource.resourceId, analysis);
      findings[analysis.finding] = (findings[analysis.finding] ?? 0) + 1;
      if (draft) drafts.push(draft);
    }
    const sync = await this.recommendations.syncDrafts(account, SNAPSHOT_RECOMMENDATION_TYPES, drafts, analyses, unreadable);
    this.logger.log({ msg: 'Snapshot analysis finished', awsAccountRef: account.id, analyzed: analyses.size, findings, drafts: drafts.length });
    return { analyzed: analyses.size, findings, ...sync };
  }

  private async scanRegion(account: AwsAccount, region: string, seenAt: Date, unavailable: Map<string, Kind>) {
    const read = async <T>(operation: string, kind: Kind, call: () => Promise<T>): Promise<T | null> => {
      try {
        return await call();
      } catch (error) {
        const err = toAwsIntegrationError(error);
        if (err.code !== 'ACCESS_DENIED') throw err;
        if (!unavailable.has(operation)) this.logger.warn({ msg: 'Snapshot data not readable: update the read-only role', awsAccountRef: account.id, operation });
        unavailable.set(operation, kind);
        return null;
      }
    };
    const amis = await read('DescribeImages', 'EBS', () => this.snapshots.amiBySnapshot(account, region));
    const ebs = amis === null ? null : await read('DescribeSnapshots', 'EBS', () => this.snapshots.listEbsSnapshots(account, region, amis));
    const rds = await read('DescribeDBSnapshots', 'RDS', () => this.snapshots.listRdsSnapshots(account, region));
    const entries: { data: AwsResourceData; snapshot: SnapshotResource }[] = [
      ...(ebs ?? []).map((s) => ({
        data: { arn: s.arn, resourceId: s.snapshotId, service: 'ec2', resourceType: SNAPSHOT_RESOURCE_TYPES.EBS, region, name: s.name ?? undefined, tags: s.tags },
        snapshot: { kind: 'EBS_SNAPSHOT' as const, snapshot: s },
      })),
      ...(rds ?? []).map((s) => ({
        data: { arn: s.arn, resourceId: s.snapshotId, service: 'rds', resourceType: SNAPSHOT_RESOURCE_TYPES.RDS, region, name: s.snapshotId, tags: s.tags },
        snapshot: { kind: 'RDS_SNAPSHOT' as const, snapshot: s },
      })),
    ];
    if (entries.length === 0) return { ebs: 0, rds: 0 };
    const price = ebs?.length ? await this.pricing.getEbsSnapshotPricePerGb(region) : null;
    await this.inventory.upsertDiscovered(account, entries.map((e) => e.data), seenAt);
    for (const e of entries) {
      await this.inventory.patchMetadata(account.id, e.data.resourceType, e.data.resourceId, { unreadableSince: null, snapshot: e.snapshot, snapshotPricePerGbMonth: price, tags: e.data.tags });
    }
    this.logger.log({ msg: 'Snapshot region enriched', awsAccountRef: account.id, region, ebsSnapshots: ebs?.length ?? 0, rdsSnapshots: rds?.length ?? 0 });
    return { ebs: ebs?.length ?? 0, rds: rds?.length ?? 0 };
  }
}

function sourceOf(resource: SnapshotResource): string | null {
  if (resource.kind === 'EBS_SNAPSHOT') return resource.snapshot.volumeId ? `ebs:${resource.snapshot.volumeId}` : null;
  return resource.snapshot.dbInstanceId ? `rds:${resource.snapshot.dbInstanceId}` : null;
}
