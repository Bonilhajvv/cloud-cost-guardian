import { Instance, InstanceTypeInfo } from '@aws-sdk/client-ec2';
import { partitionForRegion } from '../../core/helpers/arn.helper';
import { Ec2InstanceDetails, InstanceTypeSpec } from '../interfaces/ec2-instance.interface';
import { parseStoppedAt } from './stopped-at.helper';

export function isString<T extends string>(v: T | undefined): v is T {
  return typeof v === 'string' && v.length > 0;
}

export function countAccelerators(t: InstanceTypeInfo): number {
  const devices = [
    ...(t.GpuInfo?.Gpus ?? []),
    ...(t.InferenceAcceleratorInfo?.Accelerators ?? []),
    ...(t.NeuronInfo?.NeuronDevices ?? []),
    ...(t.FpgaInfo?.Fpgas ?? []),
    ...(t.MediaAcceleratorInfo?.Accelerators ?? []),
  ];
  return devices.reduce((total, d) => total + (d.Count ?? 0), 0);
}

export function normalizeInstance(
  instance: Instance,
  region: string,
  ownerId: string,
  specs: Map<string, InstanceTypeSpec>,
): Ec2InstanceDetails | null {
  if (!instance.InstanceId || !instance.InstanceType) return null;
  const tags: Record<string, string> = {};
  for (const t of instance.Tags ?? []) if (t.Key) tags[t.Key] = t.Value ?? '';
  const spec = specs.get(instance.InstanceType);
  return {
    instanceId: instance.InstanceId,
    arn: `arn:${partitionForRegion(region)}:ec2:${region}:${ownerId}:instance/${instance.InstanceId}`,
    name: tags.Name ?? null,
    instanceType: instance.InstanceType,
    state: instance.State?.Name ?? 'unknown',
    region,
    availabilityZone: instance.Placement?.AvailabilityZone ?? null,
    privateIpAddress: instance.PrivateIpAddress ?? null,
    vpcId: instance.VpcId ?? null,
    stoppedAt: parseStoppedAt(instance.StateTransitionReason),
    platform: instance.PlatformDetails ?? null,
    architecture: instance.Architecture ?? null,
    launchTime: instance.LaunchTime?.toISOString() ?? null,
    tags,
    volumeIds: (instance.BlockDeviceMappings ?? []).map((b) => b.Ebs?.VolumeId).filter(isString),
    vcpu: spec?.vcpu ?? null,
    memoryGiB: spec?.memoryGiB ?? null,
  };
}
