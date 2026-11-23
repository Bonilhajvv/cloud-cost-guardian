const BINARY: Record<string, number> = { Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, Pi: 2 ** 50, Ei: 2 ** 60 };

const DECIMAL: Record<string, number> = { n: 1e-9, u: 1e-6, m: 1e-3, k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 };

export function parseQuantity(raw: string | undefined): number {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(Ki|Mi|Gi|Ti|Pi|Ei|[numkMGTPE])?$/.exec((raw ?? '').trim());
  if (!match) return 0;
  const multiplier = match[2] ? (BINARY[match[2]] ?? DECIMAL[match[2]]) : 1;
  return Math.max(0, Number(match[1]) * multiplier);
}
