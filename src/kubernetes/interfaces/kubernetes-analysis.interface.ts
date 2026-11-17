import { Level, RecommendationSource, RecommendationType } from '../../common/enums';
import { RecommendationDraft } from '../../aws/core/interfaces/recommendation-draft.interface';
import { KubernetesCluster } from '../entities/kubernetes-cluster.entity';
import { KubernetesNode } from '../entities/kubernetes-node.entity';
import { KubernetesWorkload } from '../entities/kubernetes-workload.entity';

export type KubernetesFinding = 'OVER_PROVISIONED' | 'UNDER_PROVISIONED' | 'OPTIMIZED' | 'INSUFFICIENT_DATA';

export type SizingAction = 'DECREASE' | 'INCREASE' | 'SET';

export interface ResourceAmount {
  cpuCores: number | null;
  memoryBytes: number | null;
}

export interface UsagePeak extends ResourceAmount {
  days: number;
}

export interface ContainerSpec {
  name: string;
  requests: ResourceAmount;
  limits: ResourceAmount;
}

export interface UnitSizing {
  container: string | null;
  requests: ResourceAmount;
  limits: ResourceAmount;
  peak: ResourceAmount;
  recommended: ResourceAmount;
  cpu: SizingAction | null;
  memory: SizingAction | null;
}

export interface NodePool {
  label: string;
  value: string;
}

interface KubernetesAnalysisBase {
  kind: 'KUBERNETES';
  resourceId: string;
  resourceArn: null;
  name: string;
  clusterId: string;
  clusterName: string;
  finding: KubernetesFinding;
  recommendation: {
    type: RecommendationType;
    source: RecommendationSource;
    performanceRisk: Level;
    confidence: Level;
    reasons: string[];
  } | null;
  savings: { monthly: number; yearly: number; currency: string } | null;
  analyzedAt: string;
}

export interface KubernetesWorkloadAnalysis extends KubernetesAnalysisBase {
  scope: 'WORKLOAD';
  current: {
    monthlyCost: null;
    namespace: string;
    workloadKind: string;
    podCount: number;
    requestsPerPod: ResourceAmount;
    peakPerPod: ResourceAmount | null;
    usageDays: number;
    basis: 'CONTAINER' | 'POD';
  };
  sizing: UnitSizing[];
  recommendedRequestsPerPod: ResourceAmount | null;
}

export interface KubernetesNodeGroupAnalysis extends KubernetesAnalysisBase {
  scope: 'NODE_GROUP';
  current: {
    monthlyCost: number | null;
    pool: NodePool | null;
    instanceType: string | null;
    nodes: number;
    allocatablePerNode: ResourceAmount;
    peakRequests: ResourceAmount;
    usageDays: number;
  };
  recommendedNodes: number | null;
}

export type KubernetesAnalysis = KubernetesWorkloadAnalysis | KubernetesNodeGroupAnalysis;

export interface WorkloadAnalyzerInput {
  clusterId: string;
  clusterName: string;
  workload: {
    namespace: string;
    kind: string;
    name: string;
    podCount: number;
    requestsCpu: number | null;
    requestsMemoryBytes: number | null;
    limitsCpu: number | null;
    limitsMemoryBytes: number | null;
    hpa: unknown;
    containers: ContainerSpec[] | null;
  };
  peak: UsagePeak | null;
  containerPeaks: ReadonlyMap<string, UsagePeak>;
  currency: string;
  now?: Date;
}

export interface NodeGroupMember {
  nodeName: string;
  instanceId: string | null;
  allocatableCpu: number | null;
  allocatableMemoryBytes: number | null;
  peakRequests: UsagePeak;
  monthlyCost: number | null;
}

export interface NodeGroupAnalyzerInput {
  clusterId: string;
  clusterName: string;
  pool: NodePool | null;
  instanceType: string | null;
  nodes: NodeGroupMember[];
  currency: string;
  now?: Date;
}

export interface KubernetesAnalyzerResult {
  analysis: KubernetesAnalysis;
  drafts: RecommendationDraft[];
}

export interface ClusterAnalysisData {
  cluster: KubernetesCluster;
  workloads: { workload: KubernetesWorkload; peak: UsagePeak | null; containerPeaks: Map<string, UsagePeak> }[];
  nodes: { node: KubernetesNode; peakRequests: UsagePeak }[];
}
