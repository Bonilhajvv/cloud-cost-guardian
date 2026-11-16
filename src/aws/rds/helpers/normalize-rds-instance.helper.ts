import { DBInstance } from '@aws-sdk/client-rds';
import { RdsInstance } from '../interfaces/rds-instance.interface';

export function normalizeRdsInstance(db: DBInstance, region: string): RdsInstance | null {
  if (!db.DBInstanceIdentifier || !db.DBInstanceArn || !db.DBInstanceClass || !db.Engine) return null;
  return {
    dbInstanceId: db.DBInstanceIdentifier,
    arn: db.DBInstanceArn,
    region,
    instanceClass: db.DBInstanceClass,
    engine: db.Engine,
    engineVersion: db.EngineVersion ?? '',
    multiAz: db.MultiAZ ?? false,
    storageType: db.StorageType ?? null,
    allocatedStorageGb: db.AllocatedStorage ?? null,
    status: db.DBInstanceStatus ?? 'unknown',
    clusterId: db.DBClusterIdentifier ?? null,
    readReplicaSourceId: db.ReadReplicaSourceDBInstanceIdentifier ?? null,
    replicaIds: db.ReadReplicaDBInstanceIdentifiers ?? [],
    tags: Object.fromEntries((db.TagList ?? []).filter((t) => t.Key).map((t) => [t.Key as string, t.Value ?? ''])),
    createTime: db.InstanceCreateTime?.toISOString() ?? null,
  };
}
