import { Level, RecommendationType } from '../../common/enums';
import { EbsSnapshot, RdsSnapshot } from './interfaces/snapshot.interface';
import { SnapshotAnalyzerService } from './snapshot-analyzer.service';

const NOW = new Date('2026-11-18T12:00:00Z');
const GIB = 1024 ** 3;

const ebs = (over: Partial<EbsSnapshot> = {}): EbsSnapshot => ({
  snapshotId: 'snap-1',
  arn: 'arn:aws:ec2:us-east-1::snapshot/snap-1',
  region: 'us-east-1',
  volumeId: 'vol-1',
  volumeSizeGb: 12,
  fullSizeBytes: 8 * GIB,
  storageTier: 'standard',
  startTime: '2023-03-21T16:28:15Z',
  description: null,
  name: 'old-api',
  tags: {},
  amiId: null,
  ...over,
});

const rds = (over: Partial<RdsSnapshot> = {}): RdsSnapshot => ({
  snapshotId: 'acme-clean-token',
  arn: 'arn:aws:rds:us-east-1:123456789012:snapshot:acme-clean-token',
  region: 'us-east-1',
  dbInstanceId: 'acme-db-prd',
  engine: 'postgres',
  allocatedStorageGb: 20,
  createdAt: '2023-05-16T14:56:25Z',
  tags: {},
  ...over,
});

const run = (snapshot: EbsSnapshot, sourceExists = false, otherSnapshotsOfSource = 0, pricePerGbMonth: number | null = 0.05) =>
  new SnapshotAnalyzerService().analyze({ resourceId: snapshot.snapshotId, resourceArn: snapshot.arn, resource: { kind: 'EBS_SNAPSHOT', snapshot }, pricePerGbMonth, sourceExists, otherSnapshotsOfSource, currency: 'USD', now: NOW });

describe('SnapshotAnalyzerService', () => {
  it('deletes an old snapshot whose volume is gone, priced on its full size because nothing shares its blocks', () => {
    const { draft, analysis } = run(ebs());
    expect(analysis).toMatchObject({ finding: 'OLD', ageDays: 1337, current: { sizeGb: 8, monthlyCost: 0.4, maxMonthlyCost: 0.4 } });
    expect(draft).toMatchObject({
      type: RecommendationType.EBS_SNAPSHOT_OLD,
      title: 'Delete old EBS snapshot snap-1 (old-api)',
      estimatedMonthlySavings: 0.4,
      recommendedMonthlyCost: 0,
      risk: Level.MEDIUM,
      confidence: Level.HIGH,
      targetKey: 'DELETE',
    });
    expect(draft?.description).toContain('Source volume vol-1 no longer exists');
    expect(draft?.description).toContain('cannot be undone');
    expect(draft?.description).toContain('archive tier');
  });

  it('keeps savings unknown when other snapshots of the same volume may share its blocks', () => {
    const { draft } = run(ebs(), true, 2);
    expect(draft).toMatchObject({ estimatedMonthlySavings: null, currentMonthlyCost: null, recommendedMonthlyCost: null, confidence: Level.MEDIUM });
    expect(draft?.description).toContain('at most USD 0.4/month');
    expect(draft?.description).not.toContain('no longer exists');
  });

  it('keeps savings unknown for copied snapshots without a source volume', () => {
    expect(run(ebs({ volumeId: null })).draft?.estimatedMonthlySavings).toBeNull();
  });

  it('keeps savings unknown without a price or for the archive tier', () => {
    expect(run(ebs(), false, 0, null).draft?.estimatedMonthlySavings).toBeNull();
    const archived = run(ebs({ storageTier: 'archive' }));
    expect(archived.draft?.estimatedMonthlySavings).toBeNull();
    expect(archived.draft?.description).not.toContain('archive tier');
  });

  it('names the deregistered AMI that created the snapshot', () => {
    const { draft } = run(ebs({ description: 'Created by CreateImage(i-0e53fe90cc6a81606) for ami-065678819cdaba979' }));
    expect(draft?.description).toContain('AMI ami-065678819cdaba979 that created it was deregistered');
  });

  it('skips snapshots used by an AMI, managed by AWS Backup or DLM, and recent ones', () => {
    expect(run(ebs({ amiId: 'ami-1' }))).toMatchObject({ draft: null, analysis: { finding: 'IN_USE' } });
    expect(run(ebs({ tags: { 'aws:backup:source-resource': 'x' } }))).toMatchObject({ draft: null, analysis: { finding: 'MANAGED' } });
    expect(run(ebs({ tags: { 'aws:dlm:lifecycle-policy-id': 'policy-1' } }))).toMatchObject({ draft: null, analysis: { finding: 'MANAGED' } });
    expect(run(ebs({ startTime: '2026-09-01T00:00:00Z' }))).toMatchObject({ draft: null, analysis: { finding: 'RECENT', ageDays: 78 } });
  });

  it('deletes an old manual RDS snapshot without inventing savings', () => {
    const snapshot = rds();
    const { draft, analysis } = new SnapshotAnalyzerService().analyze({ resourceId: snapshot.snapshotId, resourceArn: snapshot.arn, resource: { kind: 'RDS_SNAPSHOT', snapshot }, pricePerGbMonth: null, sourceExists: false, otherSnapshotsOfSource: 3, currency: 'USD', now: NOW });
    expect(analysis).toMatchObject({ finding: 'OLD', current: { sizeGb: 20, monthlyCost: null } });
    expect(draft).toMatchObject({ type: RecommendationType.RDS_SNAPSHOT_OLD, service: 'rds', title: 'Delete old RDS snapshot acme-clean-token', estimatedMonthlySavings: null, confidence: Level.HIGH });
    expect(draft?.description).toContain('Database acme-db-prd no longer exists');
    expect(draft?.description).toContain('free allowance');
  });
});
