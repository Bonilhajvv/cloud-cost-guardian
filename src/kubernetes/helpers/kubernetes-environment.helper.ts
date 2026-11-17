import { detectEnvironment } from '../../aws/core/helpers/environment.helper';
import { EnvironmentInfo, ManualEnvironment } from '../../aws/core/interfaces/environment.interface';
import { NodePool } from '../interfaces/kubernetes-analysis.interface';

interface ClusterEnvironmentRef {
  name: string;
  environment: ManualEnvironment | null;
  namespaceEnvironments: Record<string, ManualEnvironment> | null;
}

const prefixed = (info: EnvironmentInfo, prefix: string): EnvironmentInfo => ({ ...info, detail: info.detail ? `${prefix} ${info.detail}` : null });

export function clusterEnvironment(cluster: ClusterEnvironmentRef): EnvironmentInfo {
  return prefixed(detectEnvironment(cluster.name, {}, cluster.environment), 'cluster');
}

export function namespaceEnvironment(cluster: ClusterEnvironmentRef, namespace: string): EnvironmentInfo {
  const manual = cluster.namespaceEnvironments?.[namespace];
  if (manual) return { environment: manual, source: 'MANUAL', detail: `namespace ${namespace} set by a user` };
  const byName = detectEnvironment(namespace, {});
  if (byName.environment !== 'UNKNOWN') return prefixed(byName, 'namespace');
  return clusterEnvironment(cluster);
}

export function nodeGroupEnvironment(cluster: ClusterEnvironmentRef, pool: NodePool | null, nodes: (EnvironmentInfo | null)[]): EnvironmentInfo {
  const ofCluster = clusterEnvironment(cluster);
  if (ofCluster.source === 'MANUAL') return ofCluster;
  const byPool = pool ? detectEnvironment(pool.value, {}) : null;
  if (byPool && byPool.environment !== 'UNKNOWN') return prefixed(byPool, 'node pool');
  if (ofCluster.environment !== 'UNKNOWN') return ofCluster;
  const first = nodes[0];
  if (first && first.environment !== 'UNKNOWN' && nodes.every((n) => n?.environment === first.environment)) {
    return { environment: first.environment, source: first.source, detail: `every node's EC2 ${first.detail}` };
  }
  return { environment: 'UNKNOWN', source: null, detail: null };
}
