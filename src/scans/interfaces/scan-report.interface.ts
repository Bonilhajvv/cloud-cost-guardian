import { CostExportStatus } from '../../aws/data-exports/interfaces/data-export.interface';
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
  rdsDatabases: number;
  network?: NetworkScanDetails;
  snapshots?: SnapshotScanDetails;
  aurora?: ServiceScanDetails;
  s3?: ServiceScanDetails;
  lambda?: ServiceScanDetails;
  regions: string[];
  failures: RegionFailure[];
  staleRemoved: number;
}

export interface OptimizerSyncDetails {
  regions: Record<string, string>;
  recommendations: number;
  failures: RegionFailure[];
  rds?: Omit<OptimizerSyncDetails, 'rds' | 'lambda'>;
  lambda?: Omit<OptimizerSyncDetails, 'rds' | 'lambda'>;
}

export interface RdsScanDetails {
  databases: number;
  failures: RegionFailure[];
}

export interface AnalysisDetails {
  ebs?: Omit<AnalysisDetails, 'ebs' | 'rds' | 'network'>;
  rds?: Omit<AnalysisDetails, 'ebs' | 'rds' | 'network'>;
  network?: Omit<AnalysisDetails, 'ebs' | 'rds' | 'network'>;
  snapshots?: Omit<AnalysisDetails, 'ebs' | 'rds' | 'network' | 'snapshots'>;
  kubernetes?: Omit<AnalysisDetails, 'ebs' | 'rds' | 'network' | 'kubernetes'>;
  schedule?: Omit<AnalysisDetails, 'ebs' | 'rds' | 'network' | 'kubernetes' | 'schedule'>;
  aurora?: ServiceAnalysisDetails;
  rdsBackup?: ServiceAnalysisDetails | null;
  s3?: ServiceAnalysisDetails;
  lambda?: ServiceAnalysisDetails;
  analyzed: number;
  findings: Record<string, number>;
  created: number;
  updated: number;
  resolved: number;
  skipped: number;
}

export interface CommitmentSyncDetails {
  fetched: boolean;
  unavailable: string[];
  potentialMonthlySavings: number;
  created: number;
  updated: number;
  resolved: number;
  skipped: number;
  error?: string;
}

export interface NetworkScanDetails {
  elasticIps: number;
  natGateways: number;
  loadBalancers: number;
  publicIpv4: number;
  unavailable: string[];
  failures: RegionFailure[];
}

export interface SnapshotScanDetails {
  ebsSnapshots: number;
  rdsSnapshots: number;
  unavailable: string[];
  failures: RegionFailure[];
}

export interface RealizedSavingsDetails {
  status: CostExportStatus;
  syncedPeriods: string[];
  rows: number;
  measured: number;
  pending: number;
  notMeasurable: number;
}

export type ServiceAnalysisDetails = Pick<AnalysisDetails, 'analyzed' | 'findings' | 'created' | 'updated' | 'resolved' | 'skipped'>;

export interface ServiceScanDetails {
  resources: number;
  unavailable: string[];
  failures: RegionFailure[];
}
