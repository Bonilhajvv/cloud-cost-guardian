export interface EbsUtilizationMetrics {
  periodDays: number;
  collectedAt: string;
  avgIops: number | null;
  peakIops: number | null;
  avgThroughputMBps: number | null;
  peakThroughputMBps: number | null;
  burstBalanceMin: number | null;
  datapoints: number;
}

export interface TimeSeries {
  timestamps: number[];
  values: number[];
}

export interface MetricQuerySpec<K extends string> {
  ownerId: string;
  kind: K;
  namespace: string;
  metricName: string;
  dimensions: { Name: string; Value: string }[];
  stat: string;
  period: number;
}
