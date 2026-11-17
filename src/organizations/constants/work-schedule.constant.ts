import { WorkSchedule } from '../interfaces/work-schedule.interface';

export const DEFAULT_WORK_SCHEDULE: WorkSchedule = { days: [1, 2, 3, 4, 5], startHour: 8, endHour: 20, timezone: 'America/Sao_Paulo' };

export const HOURS_PER_WEEK = 168;

export const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
