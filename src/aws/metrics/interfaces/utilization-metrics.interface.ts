export interface MetricSummary {
  average: number | null;
  p50?: number | null;
  p95: number | null;
  p99?: number | null;
  max: number | null;
  datapoints: number;
}

export const MEMORY_UNAVAILABLE = 'Memory metrics unavailable' as const;

export type MemorySource = 'CLOUDWATCH_AGENT' | 'CONTAINER_INSIGHTS' | 'KUBERNETES_AGENT';

export type MemoryMetrics =
  | { available: true; source?: MemorySource; usedPercent: MetricSummary }
  | { available: false; reason: typeof MEMORY_UNAVAILABLE };

export interface CpuCreditMetrics {
  balanceMin: number | null;
  balanceAvg: number | null;
  surplusChargedTotal: number;
}

export type DiskMetrics =
  | { available: true; maxUsedPercent: number; p95UsedPercent: number }
  | { available: false };

export interface DailyUsagePoint {
  date: string;
  average: number | null;
  max: number | null;
}

export interface Ec2UtilizationMetrics {
  periodDays: number;
  collectedAt: string;
  cpu: MetricSummary;
  networkInBytesPerDay: number | null;
  networkOutBytesPerDay: number | null;
  memory: MemoryMetrics;
  cpuCredits?: CpuCreditMetrics | null;
  disk?: DiskMetrics;
  cpuDaily?: DailyUsagePoint[];
  memoryDaily?: DailyUsagePoint[];
}
