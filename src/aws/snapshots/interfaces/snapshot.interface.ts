export interface EbsSnapshot {
  snapshotId: string;
  arn: string;
  region: string;
  volumeId: string | null;
  volumeSizeGb: number;
  fullSizeBytes: number | null;
  storageTier: string;
  startTime: string;
  description: string | null;
  name: string | null;
  tags: Record<string, string>;
  amiId: string | null;
}

export interface RdsSnapshot {
  snapshotId: string;
  arn: string;
  region: string;
  dbInstanceId: string | null;
  engine: string | null;
  allocatedStorageGb: number;
  createdAt: string | null;
  tags: Record<string, string>;
}

export type SnapshotResource = { kind: 'EBS_SNAPSHOT'; snapshot: EbsSnapshot } | { kind: 'RDS_SNAPSHOT'; snapshot: RdsSnapshot };
