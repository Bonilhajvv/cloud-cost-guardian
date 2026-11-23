import { HOURS_PER_MONTH } from '../constants/pricing.constant';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

export function parseOnDemandHourlyUsd(priceItem: string): number | null {
  return parseOnDemandUsd(priceItem, 'Hrs');
}

export function parseOnDemandUsd(priceItem: string, unit: string): number | null {
  return parsePrice(priceItem, unit, () => true);
}

export function parseFirstTierUsd(priceItem: string, unit: string): number | null {
  return parsePrice(priceItem, unit, (dimension) => dimension.beginRange === '0');
}

export function usageTypeMatches(priceItem: string, usage: string): boolean {
  const type = parseProductAttribute(priceItem, 'usagetype');
  return type === usage || (!!type && type.endsWith(`-${usage}`) && /^[A-Z]+\d*$/.test(type.slice(0, -usage.length - 1)));
}

function parsePrice(priceItem: string, unit: string, accepts: (dimension: Record<string, unknown>) => boolean): number | null {
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
      if (d?.unit !== unit || !accepts(d)) continue;
      const usd = Number(asRecord(d.pricePerUnit)?.USD);
      if (Number.isFinite(usd) && usd > 0) return usd;
    }
  }
  return null;
}

export function hourlyToMonthly(hourly: number): number {
  return Math.round(hourly * HOURS_PER_MONTH * 100) / 100;
}

export function parseProductAttribute(priceItem: string, attribute: string): string | null {
  try {
    const value = asRecord(asRecord(asRecord(JSON.parse(priceItem))?.product)?.attributes)?.[attribute];
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

export function parseMemoryGb(priceItem: string): number | null {
  const match = /^([\d,.]+) GiB$/.exec(parseProductAttribute(priceItem, 'memory') ?? '');
  const value = match ? Number(match[1].replaceAll(',', '')) : 0;
  return Number.isFinite(value) && value > 0 ? value : null;
}
