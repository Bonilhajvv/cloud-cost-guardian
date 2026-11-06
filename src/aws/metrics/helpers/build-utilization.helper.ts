import { average, percentile, round } from '../../../common/helpers/stats.helper';
import { QueryKind } from '../interfaces/metric-query-kind.type';
import {
  CpuCreditMetrics,
  DailyUsagePoint,
  DiskMetrics,
  Ec2UtilizationMetrics,
  MEMORY_UNAVAILABLE,
  MemorySource,
  MetricSummary,
} from '../interfaces/utilization-metrics.interface';

export function summary(avgSeries: number[], maxSeries: number[] = avgSeries): MetricSummary {
  const avg = average(avgSeries);
  const p50 = percentile(avgSeries, 50);
  const p95 = percentile(avgSeries, 95);
  const p99 = percentile(avgSeries, 99);
  const max = maxSeries.length ? Math.max(...maxSeries) : null;
  return {
    average: avg === null ? null : round(avg),
    p50: p50 === null ? null : round(p50),
    p95: p95 === null ? null : round(p95),
    p99: p99 === null ? null : round(p99),
    max: max === null ? null : round(max),
    datapoints: avgSeries.length,
  };
}

function credits(g: Partial<Record<QueryKind, number[]>>): CpuCreditMetrics | null {
  if (!g.creditMin) return null;
  const balance = g.creditMin;
  const avg = average(balance);
  return {
    balanceMin: balance.length ? round(Math.min(...balance)) : null,
    balanceAvg: avg === null ? null : round(avg),
    surplusChargedTotal: round((g.surplus ?? []).reduce((s, v) => s + v, 0)),
  };
}

function disk(values: number[] | undefined): DiskMetrics {
  if (!values?.length) return { available: false };
  return { available: true, maxUsedPercent: round(Math.max(...values)), p95UsedPercent: round(percentile(values, 95) ?? 0) };
}

export function buildUtilization(
  g: Partial<Record<QueryKind, number[]>>,
  periodDays: number,
  collectedAt: Date,
  memorySource: MemorySource = 'CLOUDWATCH_AGENT',
  daily: { cpu?: DailyUsagePoint[]; memory?: DailyUsagePoint[] } = {},
): Ec2UtilizationMetrics {
  const netIn = average(g.netIn ?? []);
  const netOut = average(g.netOut ?? []);
  const mem = g.mem ?? [];
  return {
    periodDays,
    collectedAt: collectedAt.toISOString(),
    cpu: summary(g.cpuAvg ?? [], g.cpuMax ?? []),
    networkInBytesPerDay: netIn === null ? null : Math.round(netIn),
    networkOutBytesPerDay: netOut === null ? null : Math.round(netOut),
    memory: mem.length
      ? { available: true, source: memorySource, usedPercent: summary(mem) }
      : { available: false, reason: MEMORY_UNAVAILABLE },
    cpuCredits: credits(g),
    disk: disk(g.disk),
    cpuDaily: daily.cpu ?? [],
    memoryDaily: daily.memory ?? [],
  };
}
