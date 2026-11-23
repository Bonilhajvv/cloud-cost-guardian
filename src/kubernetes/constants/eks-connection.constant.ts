export const EKS_ACCESS_GROUP = 'ccg-readonly';

export const EKS_AGENT_VERSION = 'eks-api';

export const EKS_CLUSTER_NAME_PATTERN = /^[0-9A-Za-z][A-Za-z0-9_-]{0,99}$/;

export const eksCollectLockKey = (clusterId: string): string => `ccg:eks-collect:${clusterId}`;

export const FORWARDED_LABEL_PREFIXES: readonly string[] = [
  'node.kubernetes.io/',
  'topology.kubernetes.io/',
  'node-role.kubernetes.io/',
  'eks.amazonaws.com/',
  'karpenter.sh/',
  'kubernetes.io/arch',
  'kubernetes.io/os',
];
