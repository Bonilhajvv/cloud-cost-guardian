import { HOURS_PER_MONTH } from '../constants/pricing.constant';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

export function parseOnDemandHourlyUsd(priceItem: string): number | null {
  return parseOnDemandUsd(priceItem, 'Hrs');
}

export function parseOnDemandUsd(priceItem: string, unit: string): number | null {
  let doc: unknown;
  try {
    doc = JSON.parse(priceItem);
  } catch {
    return null;
  }
  const onDemand = asRecord(asRecord(asRecord(doc)?.terms)?.OnDemand);
  if (!onDemand) return null;
  for (const term of Object.values(onDemand)) {
    const dimensions = asRecord(asRecord(term)?.priceDimensions);
    if (!dimensions) continue;
    for (const dimension of Object.values(dimensions)) {
      const d = asRecord(dimension);
      if (d?.unit !== unit) continue;
      const usd = Number(asRecord(d.pricePerUnit)?.USD);
      if (Number.isFinite(usd) && usd > 0) return usd;
    }
  }
  return null;
}

export function hourlyToMonthly(hourly: number): number {
  return Math.round(hourly * HOURS_PER_MONTH * 100) / 100;
}
