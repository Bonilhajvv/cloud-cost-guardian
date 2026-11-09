import { MetricSummary } from '../../aws/metrics/interfaces/utilization-metrics.interface';

export interface AgentPrincipal {
  clusterId: string;
  organizationId: string;
}

export interface NodeMemoryStats {
  instanceId: string;
  clusterId: string;
  clusterName: string;
  nodeName: string;
  role: string;
  provider: string;
  usedPercent: MetricSummary;
  requestsPercent: number | null;
  allocatableGb: number | null;
}

export interface ClusterSuggestion {
  awsAccountId: string;
  clusterName: string | null;
  vpcId: string | null;
  managedBy: string;
  instanceIds: string[];
  nodeNames: string[];
  estimatedMonthlyCost: number | null;
}

export interface ManifestParams {
  clusterId: string;
  clusterName: string;
  agentToken: string;
  apiUrl: string;
  image: string;
}
