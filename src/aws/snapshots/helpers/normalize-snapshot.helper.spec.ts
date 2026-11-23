import { normalizeEbsSnapshot, normalizeRdsSnapshot } from './normalize-snapshot.helper';

describe('normalizeEbsSnapshot', () => {
  const base = { SnapshotId: 'snap-1', State: 'completed' as const, StartTime: new Date('2026-01-01T00:00:00Z'), VolumeId: 'vol-1', VolumeSize: 12, FullSnapshotSizeInBytes: 1024, Tags: [{ Key: 'Name', Value: 'api' }] };

  it('builds the Resource Explorer ARN and links the AMI that uses it', () => {
    expect(normalizeEbsSnapshot(base, 'sa-east-1', new Map([['snap-1', 'ami-1']]))).toMatchObject({
      arn: 'arn:aws:ec2:sa-east-1::snapshot/snap-1',
      volumeId: 'vol-1',
      fullSizeBytes: 1024,
      storageTier: 'standard',
      name: 'api',
      amiId: 'ami-1',
    });
  });

  it('drops the placeholder volume of copied snapshots and ignores incomplete ones', () => {
    expect(normalizeEbsSnapshot({ ...base, VolumeId: 'vol-ffffffff' }, 'us-east-1', new Map())?.volumeId).toBeNull();
    expect(normalizeEbsSnapshot({ ...base, State: 'pending' }, 'us-east-1', new Map())).toBeNull();
  });
});

describe('normalizeRdsSnapshot', () => {
  it('keeps only available snapshots', () => {
    const s = { DBSnapshotIdentifier: 'bkp', DBSnapshotArn: 'arn:aws:rds:us-east-1:1:snapshot:bkp', DBInstanceIdentifier: 'db', AllocatedStorage: 20, SnapshotCreateTime: new Date('2026-01-01T00:00:00Z') };
    expect(normalizeRdsSnapshot({ ...s, Status: 'available' }, 'us-east-1')).toMatchObject({ snapshotId: 'bkp', dbInstanceId: 'db', allocatedStorageGb: 20, createdAt: '2026-01-01T00:00:00.000Z' });
    expect(normalizeRdsSnapshot({ ...s, Status: 'creating' }, 'us-east-1')).toBeNull();
  });
});
