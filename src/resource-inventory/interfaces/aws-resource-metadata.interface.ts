import { ResourceAnalysis } from '../../aws/core/interfaces/recommendation-draft.interface';
import { EbsVolume } from '../../aws/ebs/interfaces/ebs-volume.interface';
import { EbsUtilizationMetrics } from '../../aws/metrics/interfaces/ebs-metrics.interface';
import { Ec2InstanceDetails, InstanceTypeSpec } from '../../aws/ec2/interfaces/ec2-instance.interface';
import { Ec2UtilizationMetrics } from '../../aws/metrics/interfaces/utilization-metrics.interface';
import { Ec2OptimizerRecommendation } from '../../aws/optimizer/interfaces/ec2-optimizer.interface';

export interface KubernetesNodeLink {
  clusterId: string;
  clusterName: string;
  nodeName: string;
  role: string;
  podCount: number;
  allocatableMemoryGb: number | null;
  requestsMemoryGb: number | null;
  usageMemoryGb: number | null;
  reportedAt: string;
}

export interface AwsResourceMetadata {
  tags?: Record<string, string>;
  ec2?: Ec2InstanceDetails;
  downsizeCandidate?: InstanceTypeSpec | null;
  onDemandMonthlyPrices?: Record<string, number>;
  typeSpecs?: Record<string, InstanceTypeSpec>;
  metrics?: Ec2UtilizationMetrics | null;
  computeOptimizer?: Ec2OptimizerRecommendation | null;
  ebs?: EbsVolume;
  ebsMetrics?: EbsUtilizationMetrics | null;
  ebsPricePerGbMonth?: Record<string, number>;
  kubernetesNode?: KubernetesNodeLink;
  analysis?: ResourceAnalysis;
}
