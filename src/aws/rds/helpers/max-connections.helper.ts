import { GIB_BYTES } from '../../network/constants/network.constant';
import { RdsInstance } from '../interfaces/rds-instance.interface';
import { ConnectionLimit, MaxConnectionsSetting } from '../interfaces/max-connections.interface';

const FORMULA = /^(?:LEAST\(\s*)?\{\s*DBInstanceClassMemory\s*\/\s*(\d+)\s*\}(?:\s*,\s*(\d+)\s*\))?$/i;

export function defaultMaxConnections(engine: string, engineVersion: string): string | null {
  if (engine === 'postgres' || engine === 'aurora-postgresql') return 'LEAST({DBInstanceClassMemory/9531392},5000)';
  if (engine === 'mysql') return '{DBInstanceClassMemory/12582880}';
  if (engine === 'mariadb') return /^10\.[0-4](\.|$)/.test(engineVersion) ? '{DBInstanceClassMemory/12582880}' : 'LEAST({DBInstanceClassMemory/25165760},12000)';
  return null;
}

export function connectionLimit(instance: Pick<RdsInstance, 'engine' | 'engineVersion'>, memoryGb: number | null, setting: MaxConnectionsSetting | undefined): ConnectionLimit | null {
  const custom = setting?.source === 'PARAMETER_GROUP';
  const value = custom ? setting.value.trim() : defaultMaxConnections(instance.engine, instance.engineVersion);
  if (!value) return null;
  const assumed = !setting || setting.source === 'UNREADABLE';
  if (/^\d+$/.test(value)) return { limit: Number(value), fixed: true, assumed };
  const formula = FORMULA.exec(value);
  if (!formula || memoryGb === null) return null;
  const computed = Math.floor((memoryGb * GIB_BYTES) / Number(formula[1]));
  return { limit: formula[2] ? Math.min(computed, Number(formula[2])) : computed, fixed: false, assumed };
}
