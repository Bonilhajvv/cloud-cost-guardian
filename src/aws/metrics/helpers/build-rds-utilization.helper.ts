import { round } from '../../../common/helpers/stats.helper';
import { TimeSeries } from '../interfaces/ebs-metrics.interface';
import { RdsQueryKind } from '../interfaces/metric-query-kind.type';
import { RdsUtilizationMetrics } from '../interfaces/rds-metrics.interface';
import { GIB_BYTES } from '../../network/constants/network.constant';
import { summary } from './build-utilization.helper';

export function buildRdsUtilization(series: Partial<Record<RdsQueryKind, TimeSeries>>, periodDays: number, collectedAt: Date): RdsUtilizationMetrics {
  const freeStorage = series.freeStorage?.values ?? [];
  const peakOf = (read?: TimeSeries, write?: TimeSeries): number | null => (read?.values.length && write?.values.length ? Math.max(...read.values) + Math.max(...write.values) : null);
  const peakIops = peakOf(series.readIops, series.writeIops);
  const peakBytes = peakOf(series.readBytes, series.writeBytes);
  const connections = series.connections?.values ?? [];
  return {
    periodDays,
    collectedAt: collectedAt.toISOString(),
    cpu: summary(series.cpuAvg?.values ?? [], series.cpuMax?.values ?? []),
    connectionsMax: connections.length ? round(Math.max(...connections)) : null,
    connectionsDatapoints: connections.length,
    freeStorageMinGb: freeStorage.length ? round(Math.min(...freeStorage) / GIB_BYTES) : null,
    freeStorageDatapoints: freeStorage.length,
    peakIops: peakIops === null ? null : round(peakIops),
    peakThroughputMBps: peakBytes === null ? null : round(peakBytes / 1024 / 1024),
  };
}
