import { detectEnvironment } from '../../core/helpers/environment.helper';

export function nonProductionEnvironment(name: string, tags: Record<string, string>): string | null {
  const info = detectEnvironment(name, tags);
  return info.environment === 'NON_PRODUCTION' ? info.detail : null;
}
