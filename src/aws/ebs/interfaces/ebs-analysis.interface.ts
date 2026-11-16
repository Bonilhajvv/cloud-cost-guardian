import { Level, RecommendationSource, RecommendationType } from '../../../common/enums';
import { RecommendationDraft } from '../../core/interfaces/recommendation-draft.interface';
import { EbsUtilizationMetrics } from '../../metrics/interfaces/ebs-metrics.interface';
import { EbsPerformancePrices } from '../../pricing/interfaces/ebs-performance-price.interface';
import { EbsVolume } from './ebs-volume.interface';

export type EbsFinding = 'UNATTACHED' | 'GP2_TO_GP3' | 'OPTIMIZED' | 'DISK_FULL' | 'GP3_OVERPROVISIONED' | 'IO_TO_GP3';

export type EbsAction = 'SNAPSHOT_AND_DELETE' | 'MIGRATE_TO_GP3' | 'EXPAND_VOLUME' | 'REDUCE_PROVISIONED';

export interface InstanceDiskUsage {
  instanceId: string;
  p95UsedPercent: number;
  maxUsedPercent: number;
  kubernetesNode: boolean;
  source: 'CLOUDWATCH_AGENT' | 'KUBERNETES_AGENT';
}

export interface EbsAnalyzerInput {
  volume: EbsVolume;
  metrics: EbsUtilizationMetrics | null;
  pricePerGbMonth: Record<string, number>;
  currency: string;
  now?: Date;
  attachedToStoppedInstance?: boolean;
  instanceDisk?: InstanceDiskUsage | null;
  performancePrices?: EbsPerformancePrices;
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
    diskP95UsedPercent?: number | null;
    notes: string[];
  };
  recommendation: {
    type: RecommendationType;
    source: RecommendationSource;
    action: EbsAction;
    targetVolumeType: string | null;
    targetSizeGiB?: number | null;
    targetIops?: number | null;
    targetThroughputMBps?: number | null;
    performanceRisk: Level;
    confidence: Level;
    reasons: string[];
  } | null;
  savings: { monthly: number; yearly: number; currency: string } | null;
  analyzedAt: string;
}

export interface EbsAnalyzerResult {
  analysis: EbsAnalysis;
  draft: RecommendationDraft | null;
}

export interface EbsDraftText {
  monthlySavings: number | null;
  targetKey: string;
  title: string;
  description: string;
  recommendedMonthlyCost?: number | null;
  severity?: Level;
}
