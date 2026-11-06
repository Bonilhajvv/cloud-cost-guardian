export const SMALLER_SIZE: Record<string, string> = {
  micro: 'nano',
  small: 'micro',
  medium: 'small',
  large: 'medium',
  xlarge: 'large',
};

export function downsizeCandidateType(instanceType: string): string | null {
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
