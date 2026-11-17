export interface WorkSchedule {
  days: number[];
  startHour: number;
  endHour: number;
  timezone: string;
}

export interface EffectiveWorkSchedule extends WorkSchedule {
  isDefault: boolean;
  hoursPerWeek: number;
}
