import { Level } from '../../../common/enums';
import { ANALYZER_THRESHOLDS } from '../constants/analyzer-thresholds.constant';

export const LEVEL_ORDER = [Level.LOW, Level.MEDIUM, Level.HIGH];

export function mapPerformanceRisk(value: number | null): Level {
  if (value === null) return Level.MEDIUM;
  if (value <= 1) return Level.LOW;
  if (value <= 2) return Level.MEDIUM;
  return Level.HIGH;
}

export function maxLevel(a: Level, b: Level): Level {
  return LEVEL_ORDER.indexOf(a) >= LEVEL_ORDER.indexOf(b) ? a : b;
}

export function severityFor(monthlySavings: number | null): Level {
  if (monthlySavings === null) return Level.LOW;
  if (monthlySavings >= ANALYZER_THRESHOLDS.severityHigh) return Level.HIGH;
  if (monthlySavings >= ANALYZER_THRESHOLDS.severityMedium) return Level.MEDIUM;
  return Level.LOW;
}
