import { Level, RecommendationSource, RecommendationType } from '../../../common/enums';
import { RecommendationDraft } from '../../core/interfaces/recommendation-draft.interface';
import { SnapshotResource } from './snapshot.interface';

export type SnapshotFinding = 'OLD' | 'RECENT' | 'IN_USE' | 'MANAGED';

export interface SnapshotAnalysis {
  kind: 'SNAPSHOT';
  resourceId: string;
  resourceArn: string;
  name: string | null;
  region: string;
  finding: SnapshotFinding;
  ageDays: number | null;
  current: { resource: SnapshotResource['kind']; sizeGb: number; monthlyCost: number | null; maxMonthlyCost: number | null };
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

export interface SnapshotAnalyzerInput {
  resourceId: string;
  resourceArn: string;
  resource: SnapshotResource;
  pricePerGbMonth: number | null;
  sourceExists: boolean;
  otherSnapshotsOfSource: number;
  currency: string;
  now?: Date;
}

export interface SnapshotAnalyzerResult {
  analysis: SnapshotAnalysis;
  draft: RecommendationDraft | null;
}
