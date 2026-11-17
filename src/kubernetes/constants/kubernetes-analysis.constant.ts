export const MIB = 1024 ** 2;

export const K8S_ANALYSIS = {
  windowDays: 14,
  minUsageDays: 7,
  headroom: 1.3,
  maxPeakToRequest: 0.5,
  minFreedCpuCores: 0.25,
  minFreedMemoryBytes: 256 * MIB,
  cpuStepCores: 0.01,
  memoryStepBytes: 16 * MIB,
  minMemoryBytes: 64 * MIB,
  minIncreaseCpuCores: 0.05,
  minIncreaseMemoryBytes: 64 * MIB,
  nodeTargetFill: 0.85,
  spareNodes: 1,
} as const;

export const RIGHTSIZABLE_KINDS: readonly string[] = ['Deployment', 'StatefulSet', 'DaemonSet'];

export const NODE_POOL_LABELS: readonly string[] = [
  'eks.amazonaws.com/nodegroup',
  'karpenter.sh/nodepool',
  'cloud.google.com/gke-nodepool',
  'kubernetes.azure.com/agentpool',
];

export const KARPENTER_POOL_LABEL = 'karpenter.sh/nodepool';

export const CONTROL_PLANE_ROLE = 'control-plane';

export const MAX_RESOURCE_ID_LENGTH = 512;

export const MAX_TITLE_LENGTH = 255;

export const KUBERNETES_SERVICE = 'kubernetes';

export const SYSTEM_NAMESPACES: readonly string[] = ['kube-system', 'kube-public', 'kube-node-lease', 'ccg-system'];

export const SCALE_TO_ZERO_KINDS: readonly string[] = ['Deployment', 'StatefulSet'];

export const MIN_K8S_SCHEDULE_MONTHLY_SAVINGS = 5;

export const MAX_NAMESPACE_ENVIRONMENT_BATCH = 500;
