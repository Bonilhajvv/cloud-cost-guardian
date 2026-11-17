import { RecommendationStatus, RecommendationType } from '../../common/enums';
import { ResolutionReason } from '../interfaces/recommendation-metadata.interface';

export const STATUS_TRANSITIONS: Record<RecommendationStatus, readonly RecommendationStatus[]> = {
  [RecommendationStatus.OPEN]: [RecommendationStatus.REVIEWING, RecommendationStatus.ACCEPTED, RecommendationStatus.REJECTED],
  [RecommendationStatus.REVIEWING]: [RecommendationStatus.OPEN, RecommendationStatus.ACCEPTED, RecommendationStatus.REJECTED],
  [RecommendationStatus.ACCEPTED]: [RecommendationStatus.IMPLEMENTED, RecommendationStatus.REJECTED],
  [RecommendationStatus.IMPLEMENTED]: [RecommendationStatus.RESOLVED],
  [RecommendationStatus.REJECTED]: [RecommendationStatus.OPEN],
  [RecommendationStatus.RESOLVED]: [],
};

export const ACTIVE_STATUSES = [
  RecommendationStatus.OPEN,
  RecommendationStatus.REVIEWING,
  RecommendationStatus.ACCEPTED,
] as const;

export const POTENTIAL_STATUSES = [RecommendationStatus.OPEN, RecommendationStatus.REVIEWING] as const;

export const EC2_RECOMMENDATION_TYPES = [
  RecommendationType.EC2_RIGHTSIZING,
  RecommendationType.EC2_IDLE,
  RecommendationType.EC2_STOPPED,
  RecommendationType.EC2_UPSIZE,
] as const;

export const EBS_RECOMMENDATION_TYPES = [
  RecommendationType.EBS_UNUSED,
  RecommendationType.EBS_OPTIMIZATION,
  RecommendationType.EBS_EXPAND,
] as const;

export const NETWORK_RECOMMENDATION_TYPES = [
  RecommendationType.EIP_UNUSED,
  RecommendationType.NAT_GATEWAY_IDLE,
  RecommendationType.LOAD_BALANCER_IDLE,
  RecommendationType.VPC_ENDPOINT_MISSING,
] as const;

export const COMMITMENT_RECOMMENDATION_TYPES = [
  RecommendationType.SAVINGS_PLAN_PURCHASE,
  RecommendationType.RESERVED_INSTANCE_PURCHASE,
] as const;

export const RDS_RECOMMENDATION_TYPES = [
  RecommendationType.RDS_RIGHTSIZING,
  RecommendationType.RDS_UPSIZE,
  RecommendationType.RDS_IDLE,
  RecommendationType.RDS_MULTI_AZ,
  RecommendationType.RDS_EXTENDED_SUPPORT,
  RecommendationType.RDS_PUBLIC_ACCESS,
] as const;

export const SCHEDULE_RECOMMENDATION_TYPES = [RecommendationType.EC2_SCHEDULE] as const;

export const KUBERNETES_RECOMMENDATION_TYPES = [
  RecommendationType.K8S_WORKLOAD_RIGHTSIZING,
  RecommendationType.K8S_NODE_CONSOLIDATION,
  RecommendationType.K8S_WORKLOAD_UNDERSIZED,
] as const;

export const OPPORTUNITY_LABELS: Record<RecommendationType, string> = {
  [RecommendationType.EC2_RIGHTSIZING]: 'EC2 Rightsizing',
  [RecommendationType.EC2_IDLE]: 'Idle Resources',
  [RecommendationType.EC2_STOPPED]: 'Idle Resources',
  [RecommendationType.EC2_UPSIZE]: 'EC2 Rightsizing',
  [RecommendationType.RESOURCE_IDLE]: 'Idle Resources',
  [RecommendationType.EBS_UNUSED]: 'EBS',
  [RecommendationType.EBS_OPTIMIZATION]: 'EBS',
  [RecommendationType.EBS_EXPAND]: 'EBS',
  [RecommendationType.RDS_RIGHTSIZING]: 'RDS',
  [RecommendationType.RDS_UPSIZE]: 'RDS',
  [RecommendationType.RDS_IDLE]: 'Idle Resources',
  [RecommendationType.RDS_MULTI_AZ]: 'RDS',
  [RecommendationType.RDS_EXTENDED_SUPPORT]: 'RDS',
  [RecommendationType.SAVINGS_PLAN_PURCHASE]: 'Savings Plans',
  [RecommendationType.RESERVED_INSTANCE_PURCHASE]: 'Reserved Instances',
  [RecommendationType.EIP_UNUSED]: 'Idle Resources',
  [RecommendationType.NAT_GATEWAY_IDLE]: 'Idle Resources',
  [RecommendationType.LOAD_BALANCER_IDLE]: 'Idle Resources',
  [RecommendationType.VPC_ENDPOINT_MISSING]: 'Network',
  [RecommendationType.RDS_PUBLIC_ACCESS]: 'RDS',
  [RecommendationType.LAMBDA_RIGHTSIZING]: 'Lambda',
  [RecommendationType.K8S_WORKLOAD_RIGHTSIZING]: 'Kubernetes',
  [RecommendationType.K8S_NODE_CONSOLIDATION]: 'Kubernetes',
  [RecommendationType.K8S_WORKLOAD_UNDERSIZED]: 'Kubernetes',
  [RecommendationType.EC2_SCHEDULE]: 'Scheduling',
};

export const REMOVAL_TYPES: readonly RecommendationType[] = [RecommendationType.EC2_IDLE, RecommendationType.EBS_UNUSED, RecommendationType.EC2_STOPPED, RecommendationType.RDS_IDLE, RecommendationType.EIP_UNUSED, RecommendationType.NAT_GATEWAY_IDLE, RecommendationType.LOAD_BALANCER_IDLE];

export const COST_INCREASE_TYPES: readonly RecommendationType[] = [RecommendationType.EC2_UPSIZE, RecommendationType.EBS_EXPAND, RecommendationType.RDS_UPSIZE, RecommendationType.K8S_WORKLOAD_UNDERSIZED];

export const TRACKED_STATUSES = [...POTENTIAL_STATUSES, RecommendationStatus.ACCEPTED] as const;

export const ACCEPTED_CLOSING_REASONS: readonly ResolutionReason[] = ['APPLIED', 'CHANGED_DIFFERENTLY', 'RESOURCE_REMOVED'];
