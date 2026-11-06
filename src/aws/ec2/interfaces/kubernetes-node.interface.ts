export type KubernetesNodeRole = 'CONTROL_PLANE' | 'WORKER';

export interface KubernetesNodeInfo {
  role: KubernetesNodeRole;
  cluster: string | null;
  managedBy: 'EKS' | 'SELF_MANAGED';
  signals: string[];
}
