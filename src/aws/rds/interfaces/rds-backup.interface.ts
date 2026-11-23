export interface RdsBackupCost {
  region: string;
  monthlyCost: number;
  gbMonth: number;
}

export interface RdsBackupSnapshot {
  fetchedAt: string;
  regions: RdsBackupCost[];
}

export interface RdsBackupSource {
  id: string;
  retentionDays: number | null;
  nonProduction: boolean;
}

export interface RdsBackupAnalyzerInput {
  cost: RdsBackupCost;
  sources: RdsBackupSource[];
  oldManualSnapshots: number;
  currency: string;
  now?: Date;
}

