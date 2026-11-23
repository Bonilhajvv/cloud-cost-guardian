import { Snapshot, Tag } from '@aws-sdk/client-ec2';
import { DBSnapshot } from '@aws-sdk/client-rds';
import { partitionForRegion } from '../../core/helpers/arn.helper';
import { CREATE_IMAGE_PATTERN, PLACEHOLDER_VOLUME_ID } from '../constants/snapshot.constant';
import { EbsSnapshot, RdsSnapshot } from '../interfaces/snapshot.interface';

const tagsOf = (tags: Tag[] | undefined): Record<string, string> =>
  Object.fromEntries((tags ?? []).filter((t) => t.Key).map((t) => [t.Key as string, t.Value ?? '']));

export function normalizeEbsSnapshot(s: Snapshot, region: string, amiBySnapshot: ReadonlyMap<string, string>): EbsSnapshot | null {
  if (!s.SnapshotId || s.State !== 'completed' || !s.StartTime) return null;
  const tags = tagsOf(s.Tags);
  return {
    snapshotId: s.SnapshotId,
    arn: `arn:${partitionForRegion(region)}:ec2:${region}::snapshot/${s.SnapshotId}`,
    region,
    volumeId: s.VolumeId && s.VolumeId !== PLACEHOLDER_VOLUME_ID ? s.VolumeId : null,
    volumeSizeGb: s.VolumeSize ?? 0,
    fullSizeBytes: s.FullSnapshotSizeInBytes ?? null,
    storageTier: s.StorageTier ?? 'standard',
    startTime: s.StartTime.toISOString(),
    description: s.Description || null,
    name: tags.Name || null,
    tags,
    amiId: amiBySnapshot.get(s.SnapshotId) ?? null,
  };
}

export function createdByAmi(snapshot: EbsSnapshot): string | null {
  return snapshot.description?.match(CREATE_IMAGE_PATTERN)?.[1] ?? null;
}

export function normalizeRdsSnapshot(s: DBSnapshot, region: string): RdsSnapshot | null {
  if (!s.DBSnapshotIdentifier || !s.DBSnapshotArn || s.Status !== 'available') return null;
  return {
    snapshotId: s.DBSnapshotIdentifier,
    arn: s.DBSnapshotArn,
    region,
    dbInstanceId: s.DBInstanceIdentifier ?? null,
    engine: s.Engine ?? null,
    allocatedStorageGb: s.AllocatedStorage ?? 0,
    createdAt: (s.SnapshotCreateTime ?? s.OriginalSnapshotCreateTime)?.toISOString() ?? null,
    tags: tagsOf(s.TagList),
  };
}
