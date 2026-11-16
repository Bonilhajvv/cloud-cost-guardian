import { Level, RecommendationType } from '../../common/enums';
import { EbsUtilizationMetrics } from '../metrics/interfaces/ebs-metrics.interface';
import { EbsAnalyzerService } from './ebs-analyzer.service';
import { EbsAnalyzerInput, InstanceDiskUsage } from './interfaces/ebs-analysis.interface';
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

  it('skips gp3 migration for volumes attached to a long-stopped instance', () => {
    const { analysis, draft } = analyzer.analyze({
      volume: volume(),
      metrics: metrics(800, 40),
      pricePerGbMonth: PRICES,
      currency: 'USD',
      now: NOW,
      attachedToStoppedInstance: true,
    });

    expect(draft).toBeNull();
    expect(analysis.metrics.notes).toContain('Attached instance is stopped: see the stopped instance recommendation');
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

describe('EbsAnalyzerService elastic volume changes', () => {
  const analyzer = new EbsAnalyzerService();
  const ALL_PRICES = { gp2: 0.1, gp3: 0.08, io1: 0.125, io2: 0.125 };
  const PERF = { iopsMonth: { gp3: 0.005, io1: 0.065, io2: 0.065 }, throughputMBpsMonth: { gp3: 0.04 } };
  const disk = (p95: number, extra: Partial<InstanceDiskUsage> = {}): InstanceDiskUsage => ({
    instanceId: 'i-1',
    p95UsedPercent: p95,
    maxUsedPercent: p95 + 5,
    kubernetesNode: false,
    source: 'CLOUDWATCH_AGENT',
    ...extra,
  });
  const run = (overrides: Partial<EbsAnalyzerInput>) =>
    analyzer.analyze({
      volume: volume({ volumeType: 'gp3', iops: 3000, throughputMBps: 125 }),
      metrics: metrics(800, 40),
      pricePerGbMonth: ALL_PRICES,
      performancePrices: PERF,
      currency: 'USD',
      now: NOW,
      ...overrides,
    });

  describe('expand a full disk', () => {
    it('recommends a size that brings usage to about 70% with the cost increase', () => {
      const { analysis, draft } = run({ instanceDisk: disk(90) });

      expect(analysis.finding).toBe('DISK_FULL');
      expect(analysis.recommendation).toMatchObject({ action: 'EXPAND_VOLUME', targetSizeGiB: 129, targetVolumeType: 'gp3' });
      expect(draft).toMatchObject({
        type: RecommendationType.EBS_EXPAND,
        title: 'Expand data (vol-1) from 100 GiB to 129 GiB',
        severity: Level.HIGH,
        currentMonthlyCost: 8,
        recommendedMonthlyCost: 10.32,
        estimatedMonthlySavings: null,
        targetKey: 'EXPAND_VOLUME',
      });
      expect(draft?.description).toContain('Cost increase: USD 2.32/month');
      expect(draft?.description).toContain('growpart');
      expect(draft?.description).toContain('(CloudWatch Agent)');
    });

    it('wins over gp2 to gp3 and suggests both changes in one call, plus image pruning on Kubernetes nodes', () => {
      const { analysis } = run({ volume: volume(), instanceDisk: disk(88, { kubernetesNode: true, source: 'KUBERNETES_AGENT' }) });

      expect(analysis.finding).toBe('DISK_FULL');
      expect(analysis.recommendation?.reasons.join(' ')).toContain('Change the type to gp3 in the same ModifyVolume call');
      expect(analysis.recommendation?.reasons.join(' ')).toContain('crictl rmi --prune');
      expect(analysis.recommendation?.reasons.join(' ')).toContain('(Cloud Cost Guardian Kubernetes agent)');
    });

    it('keeps the cost increase unknown without price', () => {
      const { draft } = run({ instanceDisk: disk(90), pricePerGbMonth: {} });

      expect(draft).toMatchObject({ recommendedMonthlyCost: null, estimatedMonthlySavings: null });
      expect(draft?.description).toContain('Cost increase unknown');
    });

    it('does nothing below the trigger', () => {
      expect(run({ instanceDisk: disk(80) }).draft).toBeNull();
    });
  });

  describe('reduce gp3 provisioned performance', () => {
    it('drops IOPS and throughput back to the free baseline when the peak is far below', () => {
      const { analysis, draft } = run({ volume: volume({ volumeType: 'gp3', iops: 6000, throughputMBps: 500 }) });

      expect(analysis.finding).toBe('GP3_OVERPROVISIONED');
      expect(analysis.current.monthlyCost).toBe(38);
      expect(analysis.recommendation).toMatchObject({ action: 'REDUCE_PROVISIONED', targetIops: 3000, targetThroughputMBps: 125 });
      expect(draft).toMatchObject({
        type: RecommendationType.EBS_OPTIMIZATION,
        estimatedMonthlySavings: 30,
        recommendedMonthlyCost: 8,
        risk: Level.MEDIUM,
        targetKey: 'REDUCE_PROVISIONED',
      });
      expect(analysis.recommendation?.reasons.join(' ')).toContain('hourly averages');
    });

    it('keeps 1.5x headroom over the observed peak', () => {
      const { analysis, draft } = run({ volume: volume({ volumeType: 'gp3', iops: 6000, throughputMBps: 125 }), metrics: metrics(3000, 40) });

      expect(analysis.recommendation).toMatchObject({ targetIops: 4500, targetThroughputMBps: 125 });
      expect(draft?.estimatedMonthlySavings).toBe(7.5);
    });

    it('keeps savings null when performance prices are unknown', () => {
      const { draft } = run({ volume: volume({ volumeType: 'gp3', iops: 6000, throughputMBps: 125 }), performancePrices: undefined });

      expect(draft).toMatchObject({ estimatedMonthlySavings: null, currentMonthlyCost: 8 });
    });

    it('needs metrics', () => {
      expect(run({ volume: volume({ volumeType: 'gp3', iops: 6000, throughputMBps: 500 }), metrics: null }).draft).toBeNull();
    });
  });

  describe('io1/io2 to gp3', () => {
    const io1 = volume({ volumeType: 'io1', sizeGiB: 200, iops: 10000, throughputMBps: null });

    it('migrates when the peak fits gp3 and counts provisioned IOPS in the savings', () => {
      const { analysis, draft } = run({ volume: io1, metrics: metrics(2000, 100) });

      expect(analysis.finding).toBe('IO_TO_GP3');
      expect(analysis.current.monthlyCost).toBe(675);
      expect(analysis.recommendation).toMatchObject({ action: 'MIGRATE_TO_GP3', targetVolumeType: 'gp3', targetIops: 3000, targetThroughputMBps: 150 });
      expect(draft).toMatchObject({ estimatedMonthlySavings: 658, recommendedMonthlyCost: 17, targetKey: 'gp3', risk: Level.MEDIUM });
      expect(analysis.recommendation?.reasons.join(' ')).toContain('sub-millisecond');
    });

    it('skips Multi-Attach volumes', () => {
      const { analysis, draft } = run({ volume: { ...io1, attachedInstanceIds: ['i-1', 'i-2'] }, metrics: metrics(2000, 100) });

      expect(draft).toBeNull();
      expect(analysis.metrics.notes).toContain('Multi-Attach volume: gp3 does not support Multi-Attach');
    });

    it('skips when the peak with headroom exceeds gp3 limits', () => {
      const { analysis, draft } = run({ volume: io1, metrics: metrics(12000, 100) });

      expect(draft).toBeNull();
      expect(analysis.metrics.notes.join(' ')).toContain('does not fit gp3 limits');
    });

    it('keeps savings null for io2 above the first IOPS price tier', () => {
      const { analysis, draft } = run({ volume: { ...io1, volumeType: 'io2', iops: 40000 }, metrics: metrics(2000, 100) });

      expect(analysis.metrics.notes).toContain('Provisioned IOPS/throughput cost not included in monthly cost');
      expect(draft).toMatchObject({ estimatedMonthlySavings: null });
      expect(analysis.recommendation?.reasons.join(' ')).toContain('99.999% durability');
    });
  });
});
