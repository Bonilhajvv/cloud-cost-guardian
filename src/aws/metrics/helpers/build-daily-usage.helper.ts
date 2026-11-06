import { average, round } from '../../../common/helpers/stats.helper';
import { TimeSeries } from '../interfaces/ebs-metrics.interface';
import { DailyUsagePoint } from '../interfaces/utilization-metrics.interface';

function byDay(series: TimeSeries | undefined): Map<string, number[]> {
  const out = new Map<string, number[]>();
  if (!series) return out;
  series.timestamps.forEach((t, i) => {
    const day = new Date(t).toISOString().slice(0, 10);
    out.set(day, [...(out.get(day) ?? []), series.values[i]]);
  });
  return out;
}

export function buildDailyUsage(avgSeries: TimeSeries | undefined, maxSeries: TimeSeries | undefined = avgSeries): DailyUsagePoint[] {
  const avgByDay = byDay(avgSeries);
  const maxByDay = byDay(maxSeries);
  const days = [...new Set([...avgByDay.keys(), ...maxByDay.keys()])].sort();
  return days.map((date) => {
    const avg = average(avgByDay.get(date) ?? []);
    const maxValues = maxByDay.get(date) ?? [];
    return {
      date,
      average: avg === null ? null : round(avg),
      max: maxValues.length ? round(Math.max(...maxValues)) : null,
    };
  });
}
