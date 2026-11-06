import { ScanStep } from '../interfaces/scan-report.interface';

export const FULL_SCAN_STEPS: readonly ScanStep[] = ['RESOURCES', 'COSTS', 'OPTIMIZER', 'ANALYSIS'];

export const FATAL_STEPS: readonly ScanStep[] = ['RESOURCES'];

export const scanLockKey = (awsAccountRef: string): string => `ccg:scan:${awsAccountRef}`;

export const METRICS_PERIOD_DAYS = 14;

export const DEFAULT_CURRENCY = 'USD';
