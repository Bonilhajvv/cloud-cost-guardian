import { BURSTABLE_BASELINE_PERCENT, BURSTABLE_FAMILIES, T2_BASELINE_OVERRIDES } from '../constants/burstable.constant';

function split(instanceType: string): { family: string; size: string } {
  const [family = '', size = ''] = instanceType.split('.');
  return { family, size };
}

export function isBurstable(instanceType: string): boolean {
  return BURSTABLE_FAMILIES.includes(split(instanceType).family);
}

export function burstableBaselinePercent(instanceType: string): number | null {
  const { family, size } = split(instanceType);
  if (!BURSTABLE_FAMILIES.includes(family)) return null;
  if (family === 't2' && T2_BASELINE_OVERRIDES[size] !== undefined) return T2_BASELINE_OVERRIDES[size];
  return BURSTABLE_BASELINE_PERCENT[size] ?? null;
}
