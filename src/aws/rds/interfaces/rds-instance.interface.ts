export interface RdsInstance {
  dbInstanceId: string;
  arn: string;
  region: string;
  instanceClass: string;
  engine: string;
  engineVersion: string;
  multiAz: boolean;
  publiclyAccessible?: boolean;
  storageType: string | null;
  allocatedStorageGb: number | null;
  status: string;
  clusterId: string | null;
  readReplicaSourceId: string | null;
  replicaIds: string[];
  tags: Record<string, string>;
  createTime: string | null;
}

export interface RdsEngineLifecycle {
  engine: string;
  majorVersion: string;
  standardSupportEnd: string | null;
  extendedSupportEnd: string | null;
}
