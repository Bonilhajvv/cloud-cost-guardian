import { specialFamilyReason } from './instance-family.helper';
export const SMALLER_SIZE: Record<string, string> = {
  micro: 'nano',
  small: 'micro',
  medium: 'small',
  large: 'medium',
  xlarge: 'large',
};

export function downsizeCandidateType(instanceType: string): string | null {
  if (specialFamilyReason(instanceType)) return null;
  const dot = instanceType.indexOf('.');
  if (dot <= 0) return null;
  const family = instanceType.slice(0, dot);
  const size = instanceType.slice(dot + 1);
  if (SMALLER_SIZE[size]) return `${family}.${SMALLER_SIZE[size]}`;
  const match = /^(\d+)xlarge$/.exec(size);
  if (!match) return null;
  const n = Number(match[1]);
  if (n % 2 !== 0) return null;
  return n === 2 ? `${family}.xlarge` : `${family}.${n / 2}xlarge`;
}

const LARGER_SIZE: Record<string, string> = Object.fromEntries(Object.entries(SMALLER_SIZE).map(([big, small]) => [small, big]));

export function upsizeCandidateType(instanceType: string): string | null {
  if (specialFamilyReason(instanceType)) return null;
  const dot = instanceType.indexOf('.');
  if (dot <= 0) return null;
  const family = instanceType.slice(0, dot);
  const size = instanceType.slice(dot + 1);
  if (LARGER_SIZE[size]) return `${family}.${LARGER_SIZE[size]}`;
  if (size === 'xlarge') return `${family}.2xlarge`;
  const match = /^(\d+)xlarge$/.exec(size);
  return match ? `${family}.${Number(match[1]) * 2}xlarge` : null;
}
