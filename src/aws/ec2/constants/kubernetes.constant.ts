import { KubernetesNodeRole } from '../interfaces/kubernetes-node.interface';

export const K8S_MIN_MEMORY_GIB: Record<KubernetesNodeRole, number> = {
  CONTROL_PLANE: 2,
  WORKER: 2,
};

export const K8S_CLUSTER_TAG_PREFIX = 'kubernetes.io/cluster/';

export const EKS_CLUSTER_TAGS = ['eks:cluster-name', 'aws:eks:cluster-name', 'alpha.eksctl.io/cluster-name'];

export const K8S_NODE_TAGS = [
  'eks:nodegroup-name',
  'alpha.eksctl.io/nodegroup-name',
  'karpenter.sh/nodepool',
  'karpenter.sh/provisioner-name',
  'k8s.io/cluster-autoscaler/enabled',
];

export const K8S_CONTROL_PLANE_TAGS = [
  'k8s.io/role/master',
  'node-role.kubernetes.io/control-plane',
  'node-role.kubernetes.io/master',
];

export const K8S_NAME_PATTERN = /k8s|kubernetes|kube|\beks\b/i;

export const K8S_CONTROL_PLANE_NAME_PATTERN = /master|control-?plane|cp-node/i;
