import { Level, RecommendationSource, RecommendationType } from '../../../common/enums';
import { RecommendationDraft } from '../../core/interfaces/recommendation-draft.interface';
import { RdsUtilizationMetrics } from '../../metrics/interfaces/rds-metrics.interface';
import { RdsOptimizerRecommendation } from '../../optimizer/interfaces/rds-optimizer.interface';
import { RdsDeployment, RdsInstancePrice } from '../../pricing/interfaces/rds-price.interface';
import { RdsEngineLifecycle, RdsInstance } from './rds-instance.interface';

export type RdsFinding = 'OPTIMIZED' | 'IDLE' | 'RIGHTSIZE' | 'UPSIZE' | 'NOT_AVAILABLE' | 'NOT_ANALYZED';

export interface RdsPrices {
  deployment: RdsDeployment;
  byClass: Record<string, RdsInstancePrice>;
  singleAz: RdsInstancePrice | null;
}

export interface RdsAnalyzerInput {
  instance: RdsInstance;
  metrics: RdsUtilizationMetrics | null;
  optimizer: RdsOptimizerRecommendation | null;
  prices: RdsPrices | null;
  lifecycle: RdsEngineLifecycle | null;
  extendedSupportHourlyPerVcpu: number | null;
  currency: string;
  now?: Date;
}

export interface RdsAnalysis {
  kind: 'RDS';
  resourceId: string;
  resourceArn: string;
  name: string | null;
  region: string;
  finding: RdsFinding;
  current: {
    instanceClass: string;
    engine: string;
    engineVersion: string;
    multiAz: boolean;
    vcpu: number | null;
    monthlyCost: number | null;
    extendedSupportMonthlyCost: number | null;
    standardSupportEnd: string | null;
  };
  metrics: {
    periodDays: number | null;
    cpuP95: number | null;
    cpuMax: number | null;
    connectionsMax: number | null;
    memoryMaxPercent: number | null;
    notes: string[];
  };
  recommendation: {
    type: RecommendationType;
    source: RecommendationSource;
    instanceClass: string | null;
    performanceRisk: Level;
    confidence: Level;
    reasons: string[];
  } | null;
  opportunities: RecommendationType[];
  savings: { monthly: number; yearly: number; currency: string } | null;
  analyzedAt: string;
}

export interface RdsAnalyzerResult {
  analysis: RdsAnalysis;
  drafts: RecommendationDraft[];
}
