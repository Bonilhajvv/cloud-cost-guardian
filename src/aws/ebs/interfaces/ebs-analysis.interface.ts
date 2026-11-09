import { Level, RecommendationSource, RecommendationType } from '../../../common/enums';
import { EbsUtilizationMetrics } from '../../metrics/interfaces/ebs-metrics.interface';
import { EbsVolume } from './ebs-volume.interface';

export type EbsFinding = 'UNATTACHED' | 'GP2_TO_GP3' | 'OPTIMIZED';

export type EbsAction = 'SNAPSHOT_AND_DELETE' | 'MIGRATE_TO_GP3';

export interface EbsAnalyzerInput {
  volume: EbsVolume;
  metrics: EbsUtilizationMetrics | null;
  pricePerGbMonth: Record<string, number>;
  currency: string;
  now?: Date;
  attachedToStoppedInstance?: boolean;
}

export interface EbsAnalysis {
  kind: 'EBS';
  resourceId: string;
  resourceArn: string;
  name: string | null;
  region: string;
  finding: EbsFinding;
  current: {
    volumeType: string;
    sizeGiB: number;
    iops: number | null;
    throughputMBps: number | null;
    monthlyCost: number | null;
    attachedTo: string[];
  };
  metrics: {
    avgIops: number | null;
    peakIops: number | null;
    peakThroughputMBps: number | null;
    burstBalanceMin: number | null;
    notes: string[];
  };
  recommendation: {
    type: RecommendationType;
    source: RecommendationSource;
    action: EbsAction;
    targetVolumeType: string | null;
    performanceRisk: Level;
    confidence: Level;
    reasons: string[];
  } | null;
  savings: { monthly: number; yearly: number; currency: string } | null;
  analyzedAt: string;
}
