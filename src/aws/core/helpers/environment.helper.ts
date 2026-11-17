import { ENVIRONMENT_TAG_KEYS, NON_PRODUCTION_ENVIRONMENTS, PRODUCTION_ENVIRONMENTS } from '../constants/environment.constant';
import { Environment, EnvironmentInfo } from '../interfaces/environment.interface';

function classify(value: string): Environment {
  if (NON_PRODUCTION_ENVIRONMENTS.includes(value)) return 'NON_PRODUCTION';
  if (PRODUCTION_ENVIRONMENTS.includes(value)) return 'PRODUCTION';
  return 'UNKNOWN';
}

export function detectEnvironment(name: string | null, tags: Record<string, string>, override: Environment | null = null): EnvironmentInfo {
  if (override && override !== 'UNKNOWN') return { environment: override, source: 'MANUAL', detail: 'set by a user' };
  for (const [key, value] of Object.entries(tags)) {
    if (!ENVIRONMENT_TAG_KEYS.includes(key.toLowerCase())) continue;
    return { environment: classify(value.trim().toLowerCase()), source: 'TAG', detail: `tag ${key}=${value}` };
  }
  const tokens = (name ?? '').toLowerCase().split(/[-_.\s/]/);
  const nonProd = tokens.find((t) => NON_PRODUCTION_ENVIRONMENTS.includes(t));
  const prod = tokens.find((t) => PRODUCTION_ENVIRONMENTS.includes(t));
  if (nonProd && prod) return { environment: 'UNKNOWN', source: 'NAME', detail: `name contains both "${prod}" and "${nonProd}"` };
  if (nonProd) return { environment: 'NON_PRODUCTION', source: 'NAME', detail: `name contains "${nonProd}"` };
  if (prod) return { environment: 'PRODUCTION', source: 'NAME', detail: `name contains "${prod}"` };
  return { environment: 'UNKNOWN', source: null, detail: null };
}
