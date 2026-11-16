import { round } from '../../../common/helpers/stats.helper';
import { TimeSeries } from '../interfaces/ebs-metrics.interface';
import { RdsQueryKind } from '../interfaces/metric-query-kind.type';
import { RdsUtilizationMetrics } from '../interfaces/rds-metrics.interface';
import { summary } from './build-utilization.helper';

export function buildRdsUtilization(series: Partial<Record<RdsQueryKind, TimeSeries>>, periodDays: number, collectedAt: Date): RdsUtilizationMetrics {
  const connections = series.connections?.values ?? [];
  return {
    periodDays,
    collectedAt: collectedAt.toISOString(),
    cpu: summary(series.cpuAvg?.values ?? [], series.cpuMax?.values ?? []),
    connectionsMax: connections.length ? round(Math.max(...connections)) : null,
    connectionsDatapoints: connections.length,
  };
}
