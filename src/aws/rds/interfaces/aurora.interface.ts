import { Environment } from '../../core/interfaces/environment.interface';
import { TimeSeries } from '../../metrics/interfaces/ebs-metrics.interface';
import { RdsUtilizationMetrics } from '../../metrics/interfaces/rds-metrics.interface';
import { AuroraPrices } from '../../pricing/interfaces/aurora-price.interface';

export interface AuroraClusterMember {
  dbInstanceId: string;
  writer: boolean;
}

export interface AuroraCluster {
  clusterId: string;
  arn: string;
  region: string;
  engine: string;
  engineVersion: string;
  status: string;
  ioOptimized: boolean;
  serverlessMinCapacity: number | null;
  serverlessMaxCapacity: number | null;
  backupRetentionDays: number | null;
  members: AuroraClusterMember[];
  tags: Record<string, string>;
}

export interface AuroraMember extends AuroraClusterMember {
  arn: string;
  instanceClass: string;
  status: string;
  metrics: RdsUtilizationMetrics | null;
  capacity: TimeSeries | null;
}

export interface AuroraUsage {
  periodDays: number;
  storageGb: number | null;
  monthlyIoRequests: number | null;
}

export interface AuroraClusterMetadata {
  cluster: AuroraCluster;
  members: AuroraMember[];
  usage: AuroraUsage;
  prices: AuroraPrices;
}

export interface AuroraAnalyzerInput extends AuroraClusterMetadata {
  environmentOverride?: Environment | null;
  currency: string;
  now?: Date;
}
