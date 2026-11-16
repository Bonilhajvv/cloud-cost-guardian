import { Level, RecommendationSource, RecommendationType } from '../../../common/enums';
import { RecommendationDraft } from '../../core/interfaces/recommendation-draft.interface';
import { CommitmentSnapshot, CommitmentTerm } from '../../costs/interfaces/commitment.interface';

export type CommitmentFinding = 'PURCHASE' | 'NO_RECOMMENDATION';

export interface CommitmentAnalysis {
  kind: 'COMMITMENT';
  resourceId: string;
  resourceArn: string;
  name: string;
  region: 'global';
  finding: CommitmentFinding;
  current: { monthlyCost: number | null; coveragePercentage: number | null };
  recommendation: {
    type: RecommendationType;
    source: RecommendationSource;
    term: CommitmentTerm;
    hourlyCommitment: number | null;
    performanceRisk: Level;
    confidence: Level;
    reasons: string[];
  } | null;
  savings: { monthly: number; yearly: number; currency: string } | null;
  analyzedAt: string;
}

export interface CommitmentAnalyzerInput {
  awsAccountId: string;
  snapshot: CommitmentSnapshot;
  currency: string;
  now?: Date;
}

export interface CommitmentAnalyzerResult {
  analyses: CommitmentAnalysis[];
  drafts: RecommendationDraft[];
}
