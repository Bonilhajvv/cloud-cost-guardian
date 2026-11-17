import { DEFAULT_WORK_SCHEDULE, WEEKDAY_NAMES } from '../constants/work-schedule.constant';
import { EffectiveWorkSchedule, WorkSchedule } from '../interfaces/work-schedule.interface';

export function effectiveWorkSchedule(schedule: WorkSchedule | null): EffectiveWorkSchedule {
  const s = schedule ?? DEFAULT_WORK_SCHEDULE;
  return { ...s, days: [...s.days].sort((a, b) => a - b), isDefault: schedule === null, hoursPerWeek: s.days.length * (s.endHour - s.startHour) };
}

export function formatDays(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (contiguous && sorted.length > 2) return `${WEEKDAY_NAMES[sorted[0] - 1]}-${WEEKDAY_NAMES[sorted[sorted.length - 1] - 1]}`;
  return sorted.map((d) => WEEKDAY_NAMES[d - 1]).join(', ');
}
