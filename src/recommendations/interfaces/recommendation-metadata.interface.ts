import { ResourceAnalysis } from '../../aws/core/interfaces/recommendation-draft.interface';
import { OptionFit } from '../../aws/ec2/interfaces/usage-profile.interface';

export type ResolutionReason =
  | 'APPLIED'
  | 'CHANGED_DIFFERENTLY'
  | 'NOT_RUNNING'
  | 'DOES_NOT_FIT'
  | 'INSUFFICIENT_DATA'
  | 'RESOURCE_REMOVED'
  | 'NO_LONGER_RECOMMENDED';

export type SizeDirection = 'SMALLER' | 'LARGER' | 'SAME_SIZE' | 'MIXED' | 'UNKNOWN';

export interface ResourceChange {
  from: string;
  to: string;
  recommended: string | null;
  size: SizeDirection;
  comparedToRecommended: SizeDirection;
  currentFit: OptionFit | null;
  monthlyCostFrom: number | null;
  monthlyCostTo: number | null;
}

export interface RecommendationResolution {
  reason: ResolutionReason;
  finding: string | null;
  detail: string;
  change?: ResourceChange;
}

export type RealizedSource = 'ON_DEMAND_PRICE' | 'COST_EXPLORER_RESOURCE' | 'COMPUTE_OPTIMIZER' | 'RESOURCE_COST';

export interface ResolutionOutcome {
  implemented: boolean;
  realized: { amount: number; source: RealizedSource } | null;
}

export interface RecommendationMetadata {
  analysis?: ResourceAnalysis;
  latestAnalysis?: ResourceAnalysis;
  realizedSource?: RealizedSource;
  targetKey?: string | null;
  statusNote?: string;
  resolution?: RecommendationResolution;
}
