import { Volume } from '@aws-sdk/client-ec2';
import { partitionForRegion } from '../../core/helpers/arn.helper';
import { EbsVolume } from '../interfaces/ebs-volume.interface';

export function normalizeVolume(volume: Volume, region: string, ownerId: string): EbsVolume | null {
  if (!volume.VolumeId || !volume.VolumeType || volume.Size === undefined) return null;
  const tags: Record<string, string> = {};
  for (const t of volume.Tags ?? []) if (t.Key) tags[t.Key] = t.Value ?? '';
  return {
    volumeId: volume.VolumeId,
    arn: `arn:${partitionForRegion(region)}:ec2:${region}:${ownerId}:volume/${volume.VolumeId}`,
    name: tags.Name ?? null,
    volumeType: volume.VolumeType,
    sizeGiB: volume.Size,
    iops: volume.Iops ?? null,
    throughputMBps: volume.Throughput ?? null,
    state: volume.State ?? 'unknown',
    attachedInstanceIds: (volume.Attachments ?? []).map((a) => a.InstanceId).filter((id): id is string => !!id),
    createTime: volume.CreateTime?.toISOString() ?? null,
    region,
    availabilityZone: volume.AvailabilityZone ?? null,
    encrypted: volume.Encrypted ?? false,
    tags,
  };
}
