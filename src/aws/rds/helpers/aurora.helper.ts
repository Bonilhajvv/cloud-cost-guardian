import { DBCluster } from '@aws-sdk/client-rds';
import { AuroraCluster } from '../interfaces/aurora.interface';

export function isAuroraEngine(engine: string): boolean {
  return engine.startsWith('aurora');
}

export function normalizeAuroraCluster(c: DBCluster, region: string): AuroraCluster | null {
  if (!c.DBClusterIdentifier || !c.DBClusterArn || !c.Engine || !isAuroraEngine(c.Engine)) return null;
  return {
    clusterId: c.DBClusterIdentifier,
    arn: c.DBClusterArn,
    region,
    engine: c.Engine,
    engineVersion: c.EngineVersion ?? '',
    status: c.Status ?? 'unknown',
    ioOptimized: c.StorageType === 'aurora-iopt1',
    serverlessMinCapacity: c.ServerlessV2ScalingConfiguration?.MinCapacity ?? null,
    serverlessMaxCapacity: c.ServerlessV2ScalingConfiguration?.MaxCapacity ?? null,
    backupRetentionDays: c.BackupRetentionPeriod ?? null,
    members: (c.DBClusterMembers ?? []).flatMap((m) => (m.DBInstanceIdentifier ? [{ dbInstanceId: m.DBInstanceIdentifier, writer: m.IsClusterWriter ?? false }] : [])),
    tags: Object.fromEntries((c.TagList ?? []).filter((t) => t.Key).map((t) => [t.Key as string, t.Value ?? ''])),
  };
}
