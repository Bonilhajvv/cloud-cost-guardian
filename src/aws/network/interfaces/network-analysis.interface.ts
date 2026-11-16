import { Level, RecommendationSource, RecommendationType } from '../../../common/enums';
import { RecommendationDraft } from '../../core/interfaces/recommendation-draft.interface';
import { NetworkPrices, NetworkResource } from './network.interface';

export type NetworkFinding = 'IDLE' | 'MISSING_ENDPOINT' | 'OPTIMIZED' | 'INSUFFICIENT_DATA';

export interface NetworkAnalysis {
  kind: 'NETWORK';
  resourceId: string;
  resourceArn: string;
  name: string | null;
  region: string;
  finding: NetworkFinding;
  current: { resource: NetworkResource['kind']; monthlyCost: number | null };
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

export interface NetworkAnalyzerInput {
  resourceId: string;
  resourceArn: string;
  resource: NetworkResource;
  prices: NetworkPrices | null;
  currency: string;
  now?: Date;
}

export interface NetworkAnalyzerResult {
  analysis: NetworkAnalysis;
  draft: RecommendationDraft | null;
}
