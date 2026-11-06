import { DailyUsagePoint } from '../../metrics/interfaces/utilization-metrics.interface';

export interface UsageProfile {
  periodDays: number | null;
  datapoints: number;
  cpu: {
    vcpuAvailable: number | null;
    average: number | null;
    p50: number | null;
    p95: number | null;
    p99: number | null;
    max: number | null;
    p95VcpuUsed: number | null;
    peakVcpuUsed: number | null;
  };
  memory: {
    available: boolean;
    source: string | null;
    gbAvailable: number | null;
    average: number | null;
    p95: number | null;
    max: number | null;
    p95GbUsed: number | null;
    peakGbUsed: number | null;
  };
  networkMbPerDay: number | null;
  diskMaxUsedPercent: number | null;
  cpuCredits: { balanceMin: number | null; surplusCharged: number } | null;
  daily: { cpu: DailyUsagePoint[]; memory: DailyUsagePoint[] };
}

export type OptionKind = 'CURRENT' | 'DOWNSIZE' | 'COMPUTE_OPTIMIZER' | 'SAME_SIZE_ALTERNATIVE';

export type OptionFit = 'FITS' | 'TIGHT' | 'DOES_NOT_FIT' | 'UNKNOWN';

export interface InstanceOption {
  instanceType: string;
  kind: OptionKind;
  vcpu: number;
  memoryGb: number;
  architectures: string[];
  monthlyCost: number | null;
  monthlySavings: number | null;
  projected: {
    cpuP95: number | null;
    cpuMax: number | null;
    memoryP95: number | null;
    memoryPeakGb: number | null;
  };
  fit: OptionFit;
  notes: string[];
}
