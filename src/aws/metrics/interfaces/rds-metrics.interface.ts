import { MetricSummary } from './utilization-metrics.interface';

export interface RdsUtilizationMetrics {
  periodDays: number;
  collectedAt: string;
  cpu: MetricSummary;
  connectionsMax: number | null;
  connectionsDatapoints: number;
  freeStorageMinGb?: number | null;
  freeStorageDatapoints?: number;
  peakIops?: number | null;
  peakThroughputMBps?: number | null;
}
