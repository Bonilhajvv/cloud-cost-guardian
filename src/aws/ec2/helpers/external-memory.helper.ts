import { Ec2UtilizationMetrics } from '../../metrics/interfaces/utilization-metrics.interface';
import { ExternalMemoryStats } from '../interfaces/external-memory.interface';
import { KubernetesNodeInfo } from '../interfaces/kubernetes-node.interface';

export function withExternalMemory(
  metrics: Ec2UtilizationMetrics | null,
  stats: ExternalMemoryStats | null | undefined,
): Ec2UtilizationMetrics | null {
  if (!metrics || !stats || metrics.memory.available) return metrics;
  const effectiveP95 = Math.max(stats.usedPercent.p95 ?? 0, stats.requestsPercent ?? 0);
  return {
    ...metrics,
    memory: {
      available: true,
      source: 'KUBERNETES_AGENT',
      usedPercent: { ...stats.usedPercent, p95: Math.round(effectiveP95 * 100) / 100 },
    },
  };
}

export function kubernetesInfoFromStats(
  current: KubernetesNodeInfo | null,
  stats: ExternalMemoryStats | null | undefined,
): KubernetesNodeInfo | null {
  if (!stats) return current;
  return {
    role: stats.role === 'control-plane' ? 'CONTROL_PLANE' : 'WORKER',
    cluster: stats.clusterName,
    managedBy: stats.provider === 'EKS' ? 'EKS' : 'SELF_MANAGED',
    signals: [...(current?.signals ?? []), `ccg-agent node ${stats.nodeName}`],
  };
}
