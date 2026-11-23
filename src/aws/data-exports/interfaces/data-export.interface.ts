import { CUR_COLUMNS } from '../constants/data-exports.constant';

export interface ExportManifest {
  billingPeriod: string;
  key: string;
  version: string;
}

export type CurLine = Record<(typeof CUR_COLUMNS)[number], string>;

export interface UsageEntry {
  day: string;
  resourceId: string;
  service: string;
  cost: number;
  hours: number;
  hourlyCost: number;
  currency: string;
}

export type CostExportStatus = 'OK' | 'NOT_CONFIGURED' | 'WAITING_FIRST_DELIVERY' | 'ERROR';

export interface CostExportState {
  status: CostExportStatus;
  bucket: string;
  periods: Record<string, string>;
  lastSyncAt: string;
  error: string | null;
}
