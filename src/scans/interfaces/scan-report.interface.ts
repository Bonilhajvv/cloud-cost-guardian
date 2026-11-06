import { RegionFailure } from '../../aws/core/interfaces/region-run-result.interface';

export type ScanStep = 'RESOURCES' | 'COSTS' | 'OPTIMIZER' | 'ANALYSIS';

export type ScanTrigger = 'MANUAL' | 'SCHEDULED';

export interface StepResult {
  step: ScanStep;
  status: 'OK' | 'FAILED';
  durationMs: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface ScanReport {
  awsAccountRef: string;
  trigger: ScanTrigger;
  startedAt: string;
  finishedAt: string;
  status: 'FINISHED' | 'FAILED' | 'SKIPPED_LOCKED';
  steps: StepResult[];
}

export interface ResourceScanDetails {
  discoveryMode: string;
  resources: number;
  ec2Instances: number;
  ebsVolumes: number;
  regions: string[];
  failures: RegionFailure[];
  staleRemoved: number;
}

export interface OptimizerSyncDetails {
  regions: Record<string, string>;
  recommendations: number;
  failures: RegionFailure[];
}

export interface AnalysisDetails {
  ebs?: Omit<AnalysisDetails, 'ebs'>;
  analyzed: number;
  findings: Record<string, number>;
  created: number;
  updated: number;
  resolved: number;
  skipped: number;
}
