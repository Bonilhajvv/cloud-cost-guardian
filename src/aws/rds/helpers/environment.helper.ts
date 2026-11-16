import { ENVIRONMENT_TAG_KEYS, NON_PRODUCTION_ENVIRONMENTS } from '../constants/rds.constant';

export function nonProductionEnvironment(name: string, tags: Record<string, string>): string | null {
  for (const [key, value] of Object.entries(tags)) {
    if (!ENVIRONMENT_TAG_KEYS.includes(key.toLowerCase())) continue;
    const env = value.trim().toLowerCase();
    return NON_PRODUCTION_ENVIRONMENTS.includes(env) ? `tag ${key}=${value}` : null;
  }
  const token = name.toLowerCase().split(/[-_.]/).find((t) => NON_PRODUCTION_ENVIRONMENTS.includes(t));
  return token ? `name contains "${token}"` : null;
}
