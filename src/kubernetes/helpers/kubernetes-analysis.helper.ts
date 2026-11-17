import { round } from '../../common/helpers/stats.helper';
import { MIB, NODE_POOL_LABELS } from '../constants/kubernetes-analysis.constant';
import { GIB } from '../constants/kubernetes.constant';
import { NodePool } from '../interfaces/kubernetes-analysis.interface';

export function nodePoolOf(labels: Record<string, string>): NodePool | null {
  for (const label of NODE_POOL_LABELS) {
    if (labels[label]) return { label, value: labels[label] };
  }
  return null;
}

export function perPod(total: number | null, pods: number): number | null {
  return total === null || pods <= 0 ? null : total / pods;
}

export function roundUpTo(value: number, step: number): number {
  return Math.ceil(value / step - 1e-9) * step;
}

export function formatCpu(cores: number | null): string {
  return cores === null ? 'n/a' : `${Math.round(cores * 1000)}m`;
}

export function formatMemory(bytes: number | null): string {
  if (bytes === null) return 'n/a';
  return bytes >= GIB ? `${round(bytes / GIB)} GiB` : `${Math.round(bytes / MIB)} MiB`;
}

export function workloadResourceId(clusterId: string, namespace: string, kind: string, name: string): string {
  return `k8s:${clusterId}/${namespace}/${kind}/${name}`;
}

export function nodeGroupResourceId(clusterId: string, pool: NodePool | null, instanceType: string | null): string {
  return `k8s:${clusterId}/nodegroup/${pool?.value ?? '-'}/${instanceType ?? 'unknown'}`;
}
