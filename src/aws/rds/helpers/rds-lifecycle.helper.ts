import { RdsExtendedSupportYear } from '../../pricing/interfaces/rds-price.interface';
import { EXTENDED_SUPPORT_TIER1_YEARS, YEAR_MS } from '../constants/rds.constant';
import { RdsEngineLifecycle } from '../interfaces/rds-instance.interface';

export function majorVersionOf(engineVersion: string, majorVersions: readonly string[]): string | null {
  const matches = majorVersions.filter((m) => engineVersion === m || engineVersion.startsWith(`${m}.`));
  return matches.sort((a, b) => b.length - a.length)[0] ?? null;
}

export function lifecycleFor(engine: string, engineVersion: string, lifecycles: readonly RdsEngineLifecycle[]): RdsEngineLifecycle | null {
  const own = lifecycles.filter((l) => l.engine === engine);
  const major = majorVersionOf(engineVersion, own.map((l) => l.majorVersion));
  return own.find((l) => l.majorVersion === major) ?? null;
}

export function inExtendedSupport(lifecycle: RdsEngineLifecycle | null, now: Date): boolean {
  return !!lifecycle?.standardSupportEnd && Date.parse(lifecycle.standardSupportEnd) < now.getTime();
}

export function extendedSupportYear(lifecycle: RdsEngineLifecycle, now: Date): RdsExtendedSupportYear {
  const end = lifecycle.standardSupportEnd ? Date.parse(lifecycle.standardSupportEnd) : now.getTime();
  return now.getTime() - end < EXTENDED_SUPPORT_TIER1_YEARS * YEAR_MS ? 'Year 1, Year 2' : 'Year 3';
}
