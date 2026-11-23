export interface KubeOwnerRef {
  kind: string;
  name: string;
  controller?: boolean;
}

export interface KubeMeta {
  uid?: string;
  name: string;
  namespace?: string;
  labels?: Record<string, string>;
  ownerReferences?: KubeOwnerRef[];
}

export type KubeQuantities = Record<string, string>;

export interface KubeContainer {
  name: string;
  resources?: { requests?: KubeQuantities; limits?: KubeQuantities };
}

export interface KubeNode {
  metadata: KubeMeta;
  spec?: { providerID?: string };
  status?: { capacity?: KubeQuantities; allocatable?: KubeQuantities; addresses?: { type: string; address: string }[] };
}

export interface KubePod {
  metadata: KubeMeta;
  spec?: { nodeName?: string; containers?: KubeContainer[]; initContainers?: KubeContainer[] };
  status?: { phase?: string };
}

export interface KubeScalable {
  metadata: KubeMeta;
  spec?: { replicas?: number };
  status?: { desiredNumberScheduled?: number };
}

export interface KubeHpa {
  metadata: KubeMeta;
  spec: { scaleTargetRef: { kind: string; name: string }; minReplicas?: number; maxReplicas: number };
}

export interface KubeNodeMetrics {
  metadata: KubeMeta;
  usage?: KubeQuantities;
}

export interface KubePodMetrics {
  metadata: KubeMeta;
  containers?: { name: string; usage?: KubeQuantities }[];
}

export interface KubeSnapshot {
  nodes: KubeNode[];
  pods: KubePod[];
  replicaSets: KubeScalable[];
  deployments: KubeScalable[];
  statefulSets: KubeScalable[];
  daemonSets: KubeScalable[];
  hpas: KubeHpa[];
  nodeMetrics: KubeNodeMetrics[] | null;
  podMetrics: KubePodMetrics[] | null;
}
