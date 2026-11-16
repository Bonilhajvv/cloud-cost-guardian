import { InstanceDiskUsage } from '../../aws/ebs/interfaces/ebs-analysis.interface';
import { specialFamilyReason } from '../../aws/ec2/helpers/instance-family.helper';
import { detectKubernetesNode } from '../../aws/ec2/helpers/kubernetes-node.helper';
import { NodeDiskStats } from '../../kubernetes/interfaces/kubernetes.interface';
import { AwsResource } from '../../resource-inventory/entities/aws-resource.entity';

export function instanceDiskUsage(
  instances: readonly AwsResource[],
  nodeDisk: ReadonlyMap<string, NodeDiskStats> = new Map(),
): Map<string, InstanceDiskUsage> {
  const out = new Map<string, InstanceDiskUsage>();
  for (const { resourceId, metadata } of instances) {
    if (!metadata.ec2 || specialFamilyReason(metadata.ec2.instanceType)) continue;
    const disk = metadata.metrics?.disk;
    const node = nodeDisk.get(resourceId)?.usedPercent;
    if (disk?.available) {
      out.set(resourceId, {
        instanceId: resourceId,
        p95UsedPercent: disk.p95UsedPercent,
        maxUsedPercent: disk.maxUsedPercent,
        kubernetesNode: detectKubernetesNode(metadata.ec2) !== null || !!node,
        source: 'CLOUDWATCH_AGENT',
      });
    } else if (node?.p95 != null && node.max != null) {
      out.set(resourceId, { instanceId: resourceId, p95UsedPercent: node.p95, maxUsedPercent: node.max, kubernetesNode: true, source: 'KUBERNETES_AGENT' });
    }
  }
  return out;
}
