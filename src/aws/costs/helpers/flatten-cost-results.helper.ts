import { ResultByTime } from '@aws-sdk/client-cost-explorer';
import { CostLine } from '../interfaces/cost-line.interface';
import { METRIC } from '../constants/cost-explorer.constant';

export function flatten(results: ResultByTime[], key: 'service' | 'resource'): CostLine[] {
  const lines: CostLine[] = [];
  for (const r of results) {
    const periodStart = r.TimePeriod?.Start;
    const periodEnd = r.TimePeriod?.End;
    if (!periodStart || !periodEnd) continue;
    for (const g of r.Groups ?? []) {
      const metric = g.Metrics?.[METRIC];
      const name = g.Keys?.[0] ?? null;
      if (!metric?.Amount) continue;
      lines.push({
        periodStart,
        periodEnd,
        service: key === 'service' ? name : null,
        resourceId: key === 'resource' ? name : null,
        amount: Number(metric.Amount),
        currency: metric.Unit ?? 'USD',
      });
    }
  }
  return lines;
}
