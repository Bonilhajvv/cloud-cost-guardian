export function groupByRegion<T>(items: readonly T[], region: (item: T) => string | null | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const r = region(item);
    if (!r || r === 'global') continue;
    out.set(r, [...(out.get(r) ?? []), item]);
  }
  return out;
}
