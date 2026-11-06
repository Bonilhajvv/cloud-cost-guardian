import { average, round } from '../../../common/helpers/stats.helper';
import { HOUR } from '../constants/cloudwatch.constant';
import { EbsUtilizationMetrics, TimeSeries } from '../interfaces/ebs-metrics.interface';
import { EbsQueryKind } from '../interfaces/metric-query-kind.type';

function sumByTimestamp(a: TimeSeries | undefined, b: TimeSeries | undefined): number[] {
  const totals = new Map<number, number>();
  for (const s of [a, b]) {
    if (!s) continue;
    s.timestamps.forEach((t, i) => totals.set(t, (totals.get(t) ?? 0) + s.values[i]));
  }
  return [...totals.values()];
}

export function buildEbsUtilization(
  series: Partial<Record<EbsQueryKind, TimeSeries>>,
  periodDays: number,
  collectedAt: Date,
): EbsUtilizationMetrics {
  const iops = sumByTimestamp(series.readOps, series.writeOps).map((v) => v / HOUR);
  const mbps = sumByTimestamp(series.readBytes, series.writeBytes).map((v) => v / HOUR / 1024 / 1024);
  const burst = series.burstBalance?.values ?? [];
  const avgIops = average(iops);
  const avgMbps = average(mbps);
  return {
    periodDays,
    collectedAt: collectedAt.toISOString(),
    avgIops: avgIops === null ? null : round(avgIops),
    peakIops: iops.length ? round(Math.max(...iops)) : null,
    avgThroughputMBps: avgMbps === null ? null : round(avgMbps),
    peakThroughputMBps: mbps.length ? round(Math.max(...mbps)) : null,
    burstBalanceMin: burst.length ? round(Math.min(...burst)) : null,
    datapoints: iops.length,
  };
}
