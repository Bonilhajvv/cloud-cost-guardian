import { toAwsIntegrationError } from '../errors/aws-integration.error';
import { RegionRunResult } from '../interfaces/region-run-result.interface';

export async function forEachRegion<T>(
  regions: readonly string[],
  fn: (region: string) => Promise<T>,
): Promise<RegionRunResult<T>> {
  const settled = await Promise.allSettled(regions.map((region) => fn(region)));
  const out: RegionRunResult<T> = { results: [], failures: [] };
  settled.forEach((s, i) => {
    const region = regions[i];
    if (s.status === 'fulfilled') {
      out.results.push({ region, value: s.value });
    } else {
      const err = toAwsIntegrationError(s.reason);
      out.failures.push({ region, code: err.code, message: err.message });
    }
  });
  return out;
}
