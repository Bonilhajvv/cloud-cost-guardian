import { MetricSummary } from '../../metrics/interfaces/utilization-metrics.interface';

export interface ExternalMemoryStats {
  clusterName: string;
  nodeName: string;
  role: 'control-plane' | 'worker' | string;
  provider: string;
  usedPercent: MetricSummary;
  requestsPercent: number | null;
  allocatableGb: number | null;
}
