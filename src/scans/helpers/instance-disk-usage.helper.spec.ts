import { NodeDiskStats } from '../../kubernetes/interfaces/kubernetes.interface';
import { AwsResource } from '../../resource-inventory/entities/aws-resource.entity';
import { instanceDiskUsage } from './instance-disk-usage.helper';

const resource = (resourceId: string, instanceType: string, disk: unknown, tags: Record<string, string> = {}) =>
  ({ resourceId, metadata: { ec2: { instanceType, name: null, tags }, metrics: { disk } } }) as unknown as AwsResource;
const node = (instanceId: string, p95: number, max: number): [string, NodeDiskStats] => [
  instanceId,
  { instanceId, usedPercent: { average: p95 - 5, p50: p95 - 5, p95, p99: max, max, datapoints: 300 } },
];

describe('instanceDiskUsage', () => {
  it('keeps measured disks, flags Kubernetes nodes and skips families with local storage', () => {
    const out = instanceDiskUsage([
      resource('i-1', 'm6i.large', { available: true, p95UsedPercent: 90, maxUsedPercent: 95 }, { 'kubernetes.io/cluster/prd': 'owned' }),
      resource('i-2', 'm5d.large', { available: true, p95UsedPercent: 90, maxUsedPercent: 95 }),
      resource('i-3', 't3.small', { available: false }),
    ]);

    expect([...out.keys()]).toEqual(['i-1']);
    expect(out.get('i-1')).toEqual({ instanceId: 'i-1', p95UsedPercent: 90, maxUsedPercent: 95, kubernetesNode: true, source: 'CLOUDWATCH_AGENT' });
  });

  it('falls back to the Kubernetes agent node filesystem and prefers CloudWatch when both exist', () => {
    const out = instanceDiskUsage(
      [resource('i-1', 't3a.medium', { available: false }), resource('i-2', 't3a.medium', { available: true, p95UsedPercent: 40, maxUsedPercent: 50 }), resource('i-3', 'i4i.large', { available: false })],
      new Map([node('i-1', 88, 91), node('i-2', 90, 95), node('i-3', 90, 95)]),
    );

    expect(out.get('i-1')).toEqual({ instanceId: 'i-1', p95UsedPercent: 88, maxUsedPercent: 91, kubernetesNode: true, source: 'KUBERNETES_AGENT' });
    expect(out.get('i-2')).toMatchObject({ p95UsedPercent: 40, source: 'CLOUDWATCH_AGENT', kubernetesNode: true });
    expect(out.has('i-3')).toBe(false);
  });
});
