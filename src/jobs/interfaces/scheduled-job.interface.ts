import { ScanStep } from '../../scans/interfaces/scan-report.interface';

export interface ScheduledJob {
  name: string;
  step: ScanStep;
  freshnessField: 'lastScanAt' | 'lastCostSyncAt' | 'lastOptimizerSyncAt';
  minIntervalMs: number;
}
