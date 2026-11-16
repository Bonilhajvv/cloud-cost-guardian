import { provisionedPerformanceCost, volumeMonthlyCost } from './ebs-cost.helper';

const PERF = { iopsMonth: { gp3: 0.005, io1: 0.065, io2: 0.065 }, throughputMBpsMonth: { gp3: 0.04 } };
const shape = (volumeType: string, iops: number | null, throughputMBps: number | null = null) => ({ volumeType, sizeGiB: 100, iops, throughputMBps });

describe('provisionedPerformanceCost', () => {
  it.each([
    ['gp3 at baseline', shape('gp3', 3000, 125), 0],
    ['gp3 above baseline', shape('gp3', 4000, 225), 9],
    ['io1', shape('io1', 1000), 65],
    ['io2 tier 1', shape('io2', 32000), 2080],
    ['gp2', shape('gp2', 300), 0],
  ])('%s', (_, s, expected) => {
    expect(provisionedPerformanceCost(s, PERF)).toBeCloseTo(expected);
  });

  it('returns null when a needed price is missing or tiered', () => {
    expect(provisionedPerformanceCost(shape('gp3', 4000, 125), undefined)).toBeNull();
    expect(provisionedPerformanceCost(shape('io2', 40000), PERF)).toBeNull();
    expect(provisionedPerformanceCost(shape('gp3', 3000, 125), undefined)).toBe(0);
  });
});

describe('volumeMonthlyCost', () => {
  it('adds storage and provisioned performance', () => {
    expect(volumeMonthlyCost(shape('io1', 1000), { io1: 0.125 }, PERF)).toBeCloseTo(77.5);
    expect(volumeMonthlyCost(shape('io1', 1000), {}, PERF)).toBeNull();
  });
});
