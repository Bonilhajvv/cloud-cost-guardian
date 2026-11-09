import { Level, RecommendationSource, RecommendationType } from '../../../common/enums';
import { Ec2UtilizationMetrics } from '../../metrics/interfaces/utilization-metrics.interface';
import { Ec2OptimizerRecommendation } from '../../optimizer/interfaces/ec2-optimizer.interface';
import { Ec2InstanceDetails, InstanceTypeSpec } from './ec2-instance.interface';
import { ExternalMemoryStats } from './external-memory.interface';
import { KubernetesNodeInfo } from './kubernetes-node.interface';
import { InstanceOption, UsageProfile } from './usage-profile.interface';
import { RecommendationDraft } from '../../core/interfaces/recommendation-draft.interface';

export type CostSource = 'COST_EXPLORER_RESOURCE' | 'COMPUTE_OPTIMIZER' | 'ON_DEMAND_PRICE' | 'UNAVAILABLE';

export type Ec2Finding = 'RIGHTSIZE' | 'IDLE' | 'OPTIMIZED' | 'INSUFFICIENT_DATA' | 'NOT_RUNNING' | 'STOPPED' | 'UPSIZE';

export interface Ec2AnalyzerInput {
  instance: Ec2InstanceDetails;
  metrics: Ec2UtilizationMetrics | null;
  costExplorerMonthlyCost: number | null;
  optimizer: Ec2OptimizerRecommendation | null;
  downsizeCandidate: InstanceTypeSpec | null;
  upsizeCandidate?: InstanceTypeSpec | null;
  onDemandMonthlyPrices: Record<string, number>;
  typeSpecs?: Record<string, InstanceTypeSpec>;
  externalMemory?: ExternalMemoryStats | null;
  attachedVolumes?: AttachedVolumeCost[];
  kubernetesNode?: KubernetesNodeRef | null;
  now?: Date;
  currency: string;
}

export interface AttachedVolumeCost {
  volumeId: string;
  monthlyCost: number | null;
}

export interface KubernetesNodeRef {
  clusterName: string;
  nodeName: string;
}

export interface Ec2Analysis {
  kind?: 'EC2';
  resourceId: string;
  resourceArn: string;
  name: string | null;
  region: string;
  finding: Ec2Finding;
  kubernetes: KubernetesNodeInfo | null;
  current: {
    instanceType: string;
    vcpu: number | null;
    memoryGb: number | null;
    monthlyCost: number | null;
    costSource: CostSource;
  };
  metrics: {
    periodDays: number | null;
    cpuAverage: number | null;
    cpuP95: number | null;
    cpuMax: number | null;
    networkMbPerDay: number | null;
    memoryAvailable: boolean;
    memorySource?: string | null;
    memoryP95: number | null;
    cpuCreditBalanceMin?: number | null;
    cpuSurplusCreditsCharged?: number | null;
    diskMaxUsedPercent?: number | null;
    notes: string[];
  };
  recommendation: {
    type: RecommendationType;
    source: RecommendationSource;
    instanceType: string | null;
    vcpu: number | null;
    memoryGb: number | null;
    performanceRisk: Level;
    confidence: Level;
    reasons: string[];
  } | null;
  reduction: {
    vcpu: { from: number; to: number };
    memoryGb: { from: number; to: number };
  } | null;
  savings: { monthly: number; yearly: number; currency: string } | null;
  usage?: UsageProfile;
  options?: InstanceOption[];
  stoppedVolumes?: AttachedVolumeCost[];
  analyzedAt: string;
}


export interface Ec2AnalyzerOutput {
  analysis: Ec2Analysis;
  draft: RecommendationDraft | null;
}
