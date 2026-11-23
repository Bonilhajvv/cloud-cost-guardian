import { PricingService } from '../aws/pricing/pricing.service';
import { SnapshotAnalyzerService } from '../aws/snapshots/snapshot-analyzer.service';
import { SnapshotsService } from '../aws/snapshots/snapshots.service';
import { AwsAccount } from '../aws-accounts/entities/aws-account.entity';
import { RecommendationType } from '../common/enums';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { AwsResource } from '../resource-inventory/entities/aws-resource.entity';
import { AwsResourceMetadata } from '../resource-inventory/interfaces/aws-resource-metadata.interface';
import { ResourceInventoryService } from '../resource-inventory/resource-inventory.service';
import { SnapshotScanService } from './snapshot-scan.service';

const account = { id: 'acc-1', organizationId: 'org-1', awsAccountId: '111122223333' } as AwsAccount;
const GIB = 1024 ** 3;
const OLD = '2025-01-01T00:00:00.000Z';

const ebs = (snapshotId: string, volumeId: string | null) => ({
  snapshotId,
  arn: `arn:aws:ec2:us-east-1::snapshot/${snapshotId}`,
  region: 'us-east-1',
  volumeId,
  volumeSizeGb: 10,
  fullSizeBytes: 10 * GIB,
  storageTier: 'standard',
  startTime: OLD,
  description: null,
  name: null,
  tags: {},
  amiId: null,
});

function build() {
  const store = new Map<string, { type: string; arn: string; seenAt: Date; metadata: AwsResourceMetadata }>();
  const deps = {
    inventory: {
      upsertDiscovered: jest.fn(async (_a: unknown, rows: { resourceId: string; resourceType: string; arn: string; tags: Record<string, string> }[], seenAt: Date) => {
        for (const r of rows) store.set(r.resourceId, { type: r.resourceType, arn: r.arn, seenAt, metadata: { ...(store.get(r.resourceId)?.metadata ?? {}), tags: r.tags } });
        return rows.length;
      }),
      patchMetadata: jest.fn(async (_a: string, _t: string, id: string, patch: AwsResourceMetadata) => {
        const row = store.get(id);
        if (row) row.metadata = { ...row.metadata, ...patch };
      }),
      markUnreadable: jest.fn(async (_a: string, type: string, seenAt: Date) => {
        for (const r of store.values()) if (r.type === type) Object.assign(r, { seenAt, metadata: { ...r.metadata, unreadableSince: seenAt.toISOString() } });
      }),
      findByType: jest.fn(async (_a: string, type: string) =>
        [...store.entries()].filter(([, r]) => r.type === type).map(([resourceId, r]) => ({ resourceId, resourceType: r.type, arn: r.arn, region: 'us-east-1', name: null, service: 'ec2', metadata: r.metadata }) as unknown as AwsResource),
      ),
    },
    snapshots: {
      amiBySnapshot: jest.fn().mockResolvedValue(new Map()),
      listEbsSnapshots: jest.fn().mockResolvedValue([ebs('snap-only', 'vol-gone'), ebs('snap-a', 'vol-live'), ebs('snap-b', 'vol-live')]),
      listRdsSnapshots: jest.fn().mockResolvedValue([]),
    },
    pricing: { getEbsSnapshotPricePerGb: jest.fn().mockResolvedValue(0.05) },
    recommendations: { syncDrafts: jest.fn().mockResolvedValue({ created: 0, updated: 0, resolved: 0, skipped: 0 }) },
  };
  store.set('vol-live', { type: 'ec2:volume', arn: 'arn:vol-live', seenAt: new Date(0), metadata: {} });
  const service = new SnapshotScanService(
    deps.inventory as unknown as ResourceInventoryService,
    deps.snapshots as unknown as SnapshotsService,
    new SnapshotAnalyzerService(),
    deps.pricing as unknown as PricingService,
    deps.recommendations as unknown as RecommendationsService,
  );
  return { service, deps, store };
}

describe('SnapshotScanService', () => {
  it('prices only the snapshot that is alone for its volume and flags the missing volume', async () => {
    const { service, deps } = build();
    await service.scan(account, ['us-east-1'], new Date());
    await service.analyze(account);

    const drafts = deps.recommendations.syncDrafts.mock.calls[0][2] as { resourceId: string; type: RecommendationType; estimatedMonthlySavings: number | null; description: string }[];
    expect(drafts.map((d) => [d.resourceId, d.estimatedMonthlySavings])).toEqual([
      ['snap-only', 0.5],
      ['snap-a', null],
      ['snap-b', null],
    ]);
    expect(drafts[0].description).toContain('vol-gone no longer exists');
    expect(drafts[1].description).not.toContain('no longer exists');
  });

  it('keeps previous snapshots seen when the role cannot read them, so they are not removed as stale', async () => {
    const { service, deps, store } = build();
    await service.scan(account, ['us-east-1'], new Date('2026-11-01T00:00:00Z'));
    deps.snapshots.listEbsSnapshots.mockRejectedValue(Object.assign(new Error('denied'), { name: 'UnauthorizedOperation' }));
    const seenAt = new Date('2026-11-18T00:00:00Z');

    const details = await service.scan(account, ['us-east-1'], seenAt);

    expect(details).toMatchObject({ ebsSnapshots: 0, unavailable: ['DescribeSnapshots'], failures: [] });
    expect(store.get('snap-only')?.seenAt).toEqual(seenAt);
    expect(store.get('snap-only')?.metadata.snapshot).toBeDefined();

    expect(await service.analyze(account)).toMatchObject({ analyzed: 0 });
    const [, , drafts, , unreadable] = deps.recommendations.syncDrafts.mock.calls[0];
    expect(drafts).toEqual([]);
    expect([...unreadable].sort()).toEqual(['snap-a', 'snap-b', 'snap-only']);
  });

  it('does not list EBS snapshots when AMIs cannot be read, to never suggest deleting an AMI snapshot', async () => {
    const { service, deps } = build();
    deps.snapshots.amiBySnapshot.mockRejectedValue(Object.assign(new Error('denied'), { name: 'UnauthorizedOperation' }));

    const details = await service.scan(account, ['us-east-1'], new Date());

    expect(deps.snapshots.listEbsSnapshots).not.toHaveBeenCalled();
    expect(details.unavailable).toEqual(['DescribeImages']);
  });
});
