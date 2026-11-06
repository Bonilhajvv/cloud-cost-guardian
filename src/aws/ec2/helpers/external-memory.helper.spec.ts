import { MEMORY_UNAVAILABLE } from '../../metrics/interfaces/utilization-metrics.interface';
import { Ec2UtilizationMetrics } from '../../metrics/interfaces/utilization-metrics.interface';
import { kubernetesInfoFromStats, withExternalMemory } from './external-memory.helper';

const base: Ec2UtilizationMetrics = {
  periodDays: 14,
  collectedAt: '2026-11-06T00:00:00Z',
  cpu: { average: 4, p95: 5, max: 40, datapoints: 336 },
  networkInBytesPerDay: 1,
  networkOutBytesPerDay: 1,
  memory: { available: false, reason: MEMORY_UNAVAILABLE },
};
const stats = {
  clusterName: 'abrappe',
  nodeName: 'worker-1',
  role: 'worker',
  provider: 'SELF_MANAGED',
  usedPercent: { average: 30, p95: 35, max: 50, datapoints: 300 },
  requestsPercent: 60,
  allocatableGb: 3.4,
};

describe('withExternalMemory', () => {
  it('uses Kubernetes agent memory when CloudWatch has none, taking the higher of usage and requests', () => {
    const merged = withExternalMemory(base, stats);
    expect(merged?.memory).toEqual({ available: true, source: 'KUBERNETES_AGENT', usedPercent: { average: 30, p95: 60, max: 50, datapoints: 300 } });
  });

  it('keeps CloudWatch memory when present', () => {
    const withAgent: Ec2UtilizationMetrics = { ...base, memory: { available: true, source: 'CLOUDWATCH_AGENT', usedPercent: { average: 10, p95: 12, max: 20, datapoints: 300 } } };
    expect(withExternalMemory(withAgent, stats)).toBe(withAgent);
  });

  it('turns agent node info into Kubernetes context', () => {
    expect(kubernetesInfoFromStats(null, stats)).toMatchObject({ role: 'WORKER', cluster: 'abrappe', managedBy: 'SELF_MANAGED' });
    expect(kubernetesInfoFromStats(null, null)).toBeNull();
  });
});
