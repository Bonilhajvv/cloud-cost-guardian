import { Environment, EnvironmentInfo } from '../../core/interfaces/environment.interface';
import { Level, RecommendationSource, RecommendationType } from '../../../common/enums';
import { RecommendationDraft } from '../../core/interfaces/recommendation-draft.interface';
import { RdsUtilizationMetrics } from '../../metrics/interfaces/rds-metrics.interface';
import { RdsOptimizerRecommendation } from '../../optimizer/interfaces/rds-optimizer.interface';
import { RdsDeployment, RdsInstancePrice, RdsStoragePrices } from '../../pricing/interfaces/rds-price.interface';
import { MaxConnectionsSetting } from './max-connections.interface';
import { RdsEngineLifecycle, RdsInstance } from './rds-instance.interface';

export type RdsFinding = 'OPTIMIZED' | 'IDLE' | 'RIGHTSIZE' | 'UPSIZE' | 'NOT_AVAILABLE' | 'NOT_ANALYZED';

export interface RdsPrices {
  deployment: RdsDeployment;
  byClass: Record<string, RdsInstancePrice>;
  singleAz: RdsInstancePrice | null;
  publicIpv4Monthly?: number | null;
  storage?: RdsStoragePrices | null;
  singleAzStorage?: RdsStoragePrices | null;
  auroraIoOptimized?: boolean;
}

export interface RdsAnalyzerInput {
  instance: RdsInstance;
  metrics: RdsUtilizationMetrics | null;
  optimizer: RdsOptimizerRecommendation | null;
  prices: RdsPrices | null;
  lifecycle: RdsEngineLifecycle | null;
  extendedSupportHourlyPerVcpu: number | null;
  maxConnections?: MaxConnectionsSetting;
  environmentOverride?: Environment | null;
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
  environment?: EnvironmentInfo;
  current: {
    instanceClass: string;
    engine: string;
    engineVersion: string;
    multiAz: boolean;
    vcpu: number | null;
    monthlyCost: number | null;
    storageMonthlyCost?: number | null;
    storageType?: string | null;
    allocatedStorageGb?: number | null;
    extendedSupportMonthlyCost: number | null;
    standardSupportEnd: string | null;
  };
  metrics: {
    periodDays: number | null;
    cpuP95: number | null;
    cpuMax: number | null;
    connectionsMax: number | null;
    memoryMaxPercent: number | null;
    freeStorageMinGb?: number | null;
    peakIops?: number | null;
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
