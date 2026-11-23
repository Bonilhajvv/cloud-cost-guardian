import { Level, RecommendationSource, RecommendationType } from '../../../common/enums';
import { EnvironmentInfo } from './environment.interface';
import { RecommendationDraft } from './recommendation-draft.interface';

export type ServiceAnalysisKind = 'AURORA' | 'S3' | 'LAMBDA' | 'RDS_BACKUP';

export interface ServiceAnalysis {
  kind: ServiceAnalysisKind;
  resourceId: string;
  resourceArn: string | null;
  name: string | null;
  region: string;
  finding: string;
  environment?: EnvironmentInfo;
  current: { monthlyCost: number | null; details: Record<string, string | number | boolean | null> };
  notes: string[];
  recommendation: {
    type: RecommendationType;
    source: RecommendationSource;
    performanceRisk: Level;
    confidence: Level;
    reasons: string[];
  } | null;
  opportunities: RecommendationType[];
  savings: { monthly: number; yearly: number; currency: string } | null;
  analyzedAt: string;
}

export type ServiceAnalysisBase = Omit<ServiceAnalysis, 'finding' | 'recommendation' | 'opportunities' | 'savings' | 'analyzedAt'> & { finding?: string };

export interface ServiceOpportunity {
  type: RecommendationType;
  targetKey: string;
  title: string;
  reasons: string[];
  monthlySavings: number | null;
  risk: Level;
  confidence: Level;
  source?: RecommendationSource;
  resourceId?: string;
  resourceArn?: string;
  currentMonthlyCost?: number | null;
}

export interface ServiceAnalysisResult {
  analysis: ServiceAnalysis;
  drafts: RecommendationDraft[];
}
