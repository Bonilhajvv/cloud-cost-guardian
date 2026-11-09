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
] as const;

export const OPPORTUNITY_LABELS: Record<RecommendationType, string> = {
  [RecommendationType.EC2_RIGHTSIZING]: 'EC2 Rightsizing',
  [RecommendationType.EC2_IDLE]: 'Idle Resources',
  [RecommendationType.EC2_STOPPED]: 'Idle Resources',
  [RecommendationType.EC2_UPSIZE]: 'EC2 Rightsizing',
  [RecommendationType.RESOURCE_IDLE]: 'Idle Resources',
  [RecommendationType.EBS_UNUSED]: 'EBS',
  [RecommendationType.EBS_OPTIMIZATION]: 'EBS',
  [RecommendationType.RDS_RIGHTSIZING]: 'RDS',
  [RecommendationType.LAMBDA_RIGHTSIZING]: 'Lambda',
};

export const REMOVAL_TYPES: readonly RecommendationType[] = [RecommendationType.EC2_IDLE, RecommendationType.EBS_UNUSED, RecommendationType.EC2_STOPPED];

export const TRACKED_STATUSES = [...POTENTIAL_STATUSES, RecommendationStatus.ACCEPTED] as const;

export const ACCEPTED_CLOSING_REASONS: readonly ResolutionReason[] = ['APPLIED', 'CHANGED_DIFFERENTLY', 'RESOURCE_REMOVED'];
