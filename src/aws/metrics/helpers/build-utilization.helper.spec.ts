import { MEMORY_UNAVAILABLE } from '../interfaces/utilization-metrics.interface';
import { buildUtilization } from './build-utilization.helper';

describe('buildUtilization', () => {
  it('computes CPU average, p95 and max from hourly series', () => {
    const cpuAvg = Array.from({ length: 100 }, (_, i) => i + 1);
    const result = buildUtilization({ cpuAvg, cpuMax: [99, 120], netIn: [100, 300], netOut: [50] }, 14, new Date());

    expect(result.cpu).toEqual({ average: 50.5, p50: 50, p95: 95, p99: 99, max: 120, datapoints: 100 });
    expect(result.networkInBytesPerDay).toBe(200);
    expect(result.networkOutBytesPerDay).toBe(50);
  });

  it('reports memory as unavailable instead of inventing it', () => {
    const result = buildUtilization({ cpuAvg: [10] }, 14, new Date());

    expect(result.memory).toEqual({ available: false, reason: MEMORY_UNAVAILABLE });
  });

  it('uses CloudWatch Agent memory when present', () => {
    const result = buildUtilization({ cpuAvg: [10], mem: [40, 60] }, 14, new Date());

    expect(result.memory).toMatchObject({ available: true, source: 'CLOUDWATCH_AGENT', usedPercent: { average: 50, p95: 60 } });
  });

  it('labels Container Insights as memory source', () => {
    const result = buildUtilization({ cpuAvg: [10], mem: [30] }, 14, new Date(), 'CONTAINER_INSIGHTS');

    expect(result.memory).toMatchObject({ available: true, source: 'CONTAINER_INSIGHTS' });
  });

  it('summarizes CPU credits only for burstable series', () => {
    expect(buildUtilization({ cpuAvg: [10] }, 14, new Date()).cpuCredits).toBeNull();
    expect(buildUtilization({ cpuAvg: [10], creditMin: [100, 20, 50], surplus: [0, 1.5] }, 14, new Date()).cpuCredits).toEqual({
      balanceMin: 20,
      balanceAvg: 56.67,
      surplusChargedTotal: 1.5,
    });
  });

  it('reports disk usage from the agent', () => {
    expect(buildUtilization({ cpuAvg: [10] }, 14, new Date()).disk).toEqual({ available: false });
    expect(buildUtilization({ cpuAvg: [10], disk: [40, 90, 70] }, 14, new Date()).disk).toEqual({
      available: true,
      maxUsedPercent: 90,
      p95UsedPercent: 90,
    });
  });
});
