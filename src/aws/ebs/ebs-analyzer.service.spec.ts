import { Level, RecommendationType } from '../../common/enums';
import { EbsUtilizationMetrics } from '../metrics/interfaces/ebs-metrics.interface';
import { EbsAnalyzerService } from './ebs-analyzer.service';
import { EbsVolume } from './interfaces/ebs-volume.interface';

const NOW = new Date('2026-11-06T00:00:00Z');
const PRICES = { gp2: 0.1, gp3: 0.08 };

function volume(overrides: Partial<EbsVolume> = {}): EbsVolume {
  return {
    volumeId: 'vol-1',
    arn: 'arn:aws:ec2:us-east-1:111122223333:volume/vol-1',
    name: 'data',
    volumeType: 'gp2',
    sizeGiB: 100,
    iops: 300,
    throughputMBps: null,
    state: 'in-use',
    attachedInstanceIds: ['i-1'],
    createTime: '2025-01-01T00:00:00.000Z',
    region: 'us-east-1',
    availabilityZone: 'us-east-1a',
    encrypted: true,
    tags: {},
    ...overrides,
  };
}

function metrics(peakIops: number, peakMbps: number): EbsUtilizationMetrics {
  return {
    periodDays: 14,
    collectedAt: NOW.toISOString(),
    avgIops: peakIops / 4,
    peakIops,
    avgThroughputMBps: peakMbps / 4,
    peakThroughputMBps: peakMbps,
    burstBalanceMin: 99,
    datapoints: 336,
  };
}

describe('EbsAnalyzerService', () => {
  const analyzer = new EbsAnalyzerService();

  it('flags unattached volumes with full storage cost as savings', () => {
    const { analysis, draft } = analyzer.analyze({
      volume: volume({ state: 'available', attachedInstanceIds: [] }),
      metrics: null,
      pricePerGbMonth: PRICES,
      currency: 'USD',
      now: NOW,
    });

    expect(analysis.finding).toBe('UNATTACHED');
    expect(draft).toMatchObject({
      type: RecommendationType.EBS_UNUSED,
      service: 'ebs',
      currentMonthlyCost: 10,
      estimatedMonthlySavings: 10,
      estimatedYearlySavings: 120,
      risk: Level.MEDIUM,
      confidence: Level.HIGH,
      targetKey: 'DELETE',
    });
  });

  it('lowers confidence for recently created unattached volumes', () => {
    const { draft } = analyzer.analyze({
      volume: volume({ state: 'available', attachedInstanceIds: [], createTime: '2026-11-04T00:00:00.000Z' }),
      metrics: null,
      pricePerGbMonth: PRICES,
      currency: 'USD',
      now: NOW,
    });

    expect(draft?.confidence).toBe(Level.MEDIUM);
  });

  it('recommends gp2 to gp3 when usage fits the gp3 baseline', () => {
    const { analysis, draft } = analyzer.analyze({ volume: volume(), metrics: metrics(800, 40), pricePerGbMonth: PRICES, currency: 'USD', now: NOW });

    expect(analysis.finding).toBe('GP2_TO_GP3');
    expect(draft).toMatchObject({
      type: RecommendationType.EBS_OPTIMIZATION,
      estimatedMonthlySavings: 2,
      recommendedMonthlyCost: 8,
      risk: Level.LOW,
      confidence: Level.HIGH,
      targetKey: 'gp3',
    });
  });

  it('skips gp3 migration when peak usage exceeds the gp3 baseline', () => {
    const { analysis, draft } = analyzer.analyze({ volume: volume(), metrics: metrics(4500, 40), pricePerGbMonth: PRICES, currency: 'USD', now: NOW });

    expect(draft).toBeNull();
    expect(analysis.metrics.notes.join(' ')).toContain('above gp3 baseline');
  });

  it('keeps savings null when prices are unavailable', () => {
    const { draft } = analyzer.analyze({ volume: volume(), metrics: metrics(800, 40), pricePerGbMonth: {}, currency: 'USD', now: NOW });

    expect(draft).toMatchObject({ estimatedMonthlySavings: null, currentMonthlyCost: null });
  });

  it('leaves gp3 volumes alone', () => {
    const { draft } = analyzer.analyze({ volume: volume({ volumeType: 'gp3' }), metrics: metrics(800, 40), pricePerGbMonth: PRICES, currency: 'USD', now: NOW });

    expect(draft).toBeNull();
  });
});
