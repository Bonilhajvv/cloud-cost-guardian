import { CostExportState } from '../../aws/data-exports/interfaces/data-export.interface';

export interface CostUsageSyncResult {
  state: CostExportState;
  syncedPeriods: string[];
  rows: number;
}

export interface DailyUsage {
  day: string;
  cost: number;
  hours: number;
  hourlyCost: number;
}
