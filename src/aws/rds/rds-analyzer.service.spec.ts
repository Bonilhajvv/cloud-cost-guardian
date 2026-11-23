import { Level, RecommendationSource, RecommendationType } from '../../common/enums';
import { RdsOptimizerRecommendation } from '../optimizer/interfaces/rds-optimizer.interface';
import { RdsAnalysis, RdsAnalyzerInput } from './interfaces/rds-analysis.interface';
import { RdsInstance } from './interfaces/rds-instance.interface';
import { RdsAnalyzerService } from './rds-analyzer.service';

const NOW = new Date('2026-11-16T00:00:00Z');

function db(overrides: Partial<RdsInstance> = {}): RdsInstance {
  return {
    dbInstanceId: 'orders-prd',
    arn: 'arn:aws:rds:us-east-1:111122223333:db:orders-prd',
    region: 'us-east-1',
    instanceClass: 'db.m6g.large',
    engine: 'postgres',
    engineVersion: '16.4',
    multiAz: false,
    storageType: 'gp3',
    allocatedStorageGb: 100,
    status: 'available',
    clusterId: null,
    readReplicaSourceId: null,
    replicaIds: [],
    tags: {},
    createTime: null,
    ...overrides,
  };
}

function optimizer(overrides: Partial<RdsOptimizerRecommendation> = {}): RdsOptimizerRecommendation {
  return {
    resourceArn: 'arn:aws:rds:us-east-1:111122223333:db:orders-prd',
    dbInstanceId: 'orders-prd',
    currentInstanceClass: 'db.m6g.large',
    finding: 'OPTIMIZED',
    idle: false,
    lookBackPeriodDays: 14,
    options: [{ instanceClass: 'db.m6g.large', rank: 1, performanceRisk: 1, estimatedMonthlySavings: 0 }],
    utilization: { 'CPU Maximum': 20, 'Memory Maximum': 40, 'DatabaseConnections Maximum': 12 },
    ...overrides,
  };
}

const PRICES = {
  deployment: 'Single-AZ' as const,
  byClass: { 'db.m6g.large': { monthly: 109.5, vcpu: 2 }, 'db.m6g.xlarge': { monthly: 219, vcpu: 4 }, 'db.t4g.large': { monthly: 94.9, vcpu: 2 } },
  singleAz: null,
};

function input(overrides: Partial<RdsAnalyzerInput> = {}): RdsAnalyzerInput {
  return {
    instance: db(),
    metrics: { periodDays: 14, collectedAt: NOW.toISOString(), cpu: { average: 10, p95: 18, max: 30, datapoints: 336 }, connectionsMax: 12, connectionsDatapoints: 336 },
    optimizer: optimizer(),
    prices: PRICES,
    lifecycle: { engine: 'postgres', majorVersion: '16', standardSupportEnd: '2029-02-28T23:59:59.999Z', extendedSupportEnd: '2032-02-29T23:59:59.999Z' },
    extendedSupportHourlyPerVcpu: null,
    currency: 'USD',
    now: NOW,
    ...overrides,
  };
}

describe('RdsAnalyzerService', () => {
  const analyzer = new RdsAnalyzerService();
  const types = (r: { drafts: { type: RecommendationType }[] }) => r.drafts.map((d) => d.type);

  it('leaves a busy, right-sized production database alone', () => {
    const result = analyzer.analyze(input());

    expect(result.analysis.finding).toBe('OPTIMIZED');
    expect(result.drafts).toEqual([]);
    expect(result.analysis.current).toMatchObject({ instanceClass: 'db.m6g.large', monthlyCost: 109.5, vcpu: 2 });
    expect(result.analysis.metrics.memoryMaxPercent).toBe(40);
  });

  describe('idle', () => {
    it('flags a database without connections for 14 days and stops there', () => {
      const result = analyzer.analyze(
        input({
          instance: db({ multiAz: true, tags: { Environment: 'dev' } }),
          metrics: { periodDays: 14, collectedAt: NOW.toISOString(), cpu: { average: 1, p95: 2, max: 3, datapoints: 336 }, connectionsMax: 0, connectionsDatapoints: 336 },
        }),
      );

      expect(result.analysis.finding).toBe('IDLE');
      expect(types(result)).toEqual([RecommendationType.RDS_IDLE]);
      expect(result.drafts[0]).toMatchObject({ estimatedMonthlySavings: 109.5, targetKey: 'DELETE', source: RecommendationSource.CCG_HEURISTIC, service: 'rds' });
      expect(result.drafts[0].description).toContain('final snapshot');
    });

    it('trusts Compute Optimizer idle but not a short metric window', () => {
      expect(types(analyzer.analyze(input({ optimizer: optimizer({ idle: true }) })))).toEqual([RecommendationType.RDS_IDLE]);
      const short = analyzer.analyze(
        input({ optimizer: null, metrics: { periodDays: 2, collectedAt: NOW.toISOString(), cpu: { average: 1, p95: 1, max: 1, datapoints: 48 }, connectionsMax: 0, connectionsDatapoints: 48 } }),
      );
      expect(short.drafts).toEqual([]);
    });

    it('never calls a replication source idle', () => {
      const result = analyzer.analyze(input({ instance: db({ replicaIds: ['orders-replica'] }), optimizer: optimizer({ idle: true }) }));

      expect(types(result)).not.toContain(RecommendationType.RDS_IDLE);
    });
  });

  describe('resize from Compute Optimizer', () => {
    it('rightsizes with at least MEDIUM risk and warns about the buffer cache', () => {
      const result = analyzer.analyze(
        input({
          optimizer: optimizer({
            finding: 'OVER_PROVISIONED',
            options: [
              { instanceClass: 'db.m6g.large', rank: 2, performanceRisk: 1, estimatedMonthlySavings: 0 },
              { instanceClass: 'db.t4g.large', rank: 1, performanceRisk: 1, estimatedMonthlySavings: 14.6 },
            ],
          }),
        }),
      );

      expect(result.analysis.finding).toBe('RIGHTSIZE');
      expect(result.drafts[0]).toMatchObject({
        type: RecommendationType.RDS_RIGHTSIZING,
        targetKey: 'db.t4g.large',
        estimatedMonthlySavings: 14.6,
        recommendedMonthlyCost: 94.9,
        risk: Level.MEDIUM,
      });
      expect(result.drafts[0].description).toContain('buffer cache');
      expect(result.drafts[0].description).toContain('restarts the database');
    });

    it('upsizes an under-provisioned database with the cost increase', () => {
      const result = analyzer.analyze(
        input({ optimizer: optimizer({ finding: 'UNDER_PROVISIONED', options: [{ instanceClass: 'db.m6g.xlarge', rank: 1, performanceRisk: 1, estimatedMonthlySavings: null }] }) }),
      );

      expect(result.analysis.finding).toBe('UPSIZE');
      expect(result.drafts[0]).toMatchObject({
        type: RecommendationType.RDS_UPSIZE,
        targetKey: 'db.m6g.xlarge',
        severity: Level.HIGH,
        estimatedMonthlySavings: null,
        recommendedMonthlyCost: 219,
      });
      expect(result.drafts[0].description).toContain('Cost increase: USD 109.5/month');
    });
  });

  describe('Multi-AZ outside production', () => {
    const multi = { deployment: 'Multi-AZ' as const, byClass: { 'db.m6g.large': { monthly: 219, vcpu: 2 } }, singleAz: { monthly: 109.5, vcpu: 2 } };

    it('recommends Single-AZ for a database tagged as non-production', () => {
      const result = analyzer.analyze(input({ instance: db({ dbInstanceId: 'orders', multiAz: true, tags: { Environment: 'Staging' } }), prices: multi }));

      expect(result.drafts[0]).toMatchObject({ type: RecommendationType.RDS_MULTI_AZ, estimatedMonthlySavings: 109.5, confidence: Level.HIGH, targetKey: 'SINGLE_AZ' });
    });

    it('uses the name with lower confidence and never touches production', () => {
      expect(analyzer.analyze(input({ instance: db({ dbInstanceId: 'orders-hml', multiAz: true }), prices: multi })).drafts[0].confidence).toBe(Level.MEDIUM);
      expect(analyzer.analyze(input({ instance: db({ multiAz: true, tags: { env: 'production' } }), prices: multi })).drafts).toEqual([]);
      expect(analyzer.analyze(input({ instance: db({ dbInstanceId: 'orders-prd-test', multiAz: true, tags: { env: 'prod' } }), prices: multi })).drafts).toEqual([]);
    });

    it('follows a manual mark over tags and name', () => {
      const marked = analyzer.analyze(input({ instance: db({ dbInstanceId: 'orders', multiAz: true, tags: { env: 'prod' } }), prices: multi, environmentOverride: 'NON_PRODUCTION' }));
      expect(marked.analysis.environment).toMatchObject({ environment: 'NON_PRODUCTION', source: 'MANUAL' });
      expect(marked.drafts[0]).toMatchObject({ type: RecommendationType.RDS_MULTI_AZ, confidence: Level.HIGH });
      expect(analyzer.analyze(input({ instance: db({ dbInstanceId: 'orders-hml', multiAz: true }), prices: multi, environmentOverride: 'PRODUCTION' })).drafts).toEqual([]);
    });
  });

  describe('Extended Support', () => {
    const pg13 = { engine: 'postgres', majorVersion: '13', standardSupportEnd: '2026-02-28T23:59:59.999Z', extendedSupportEnd: '2029-02-28T23:59:59.999Z' };

    it('prices Extended Support per vCPU and recommends the upgrade', () => {
      const result = analyzer.analyze(input({ instance: db({ engineVersion: '13.15' }), lifecycle: pg13, extendedSupportHourlyPerVcpu: 0.1 }));

      expect(result.analysis.current).toMatchObject({ extendedSupportMonthlyCost: 146, monthlyCost: 255.5 });
      expect(result.drafts[0]).toMatchObject({ type: RecommendationType.RDS_EXTENDED_SUPPORT, estimatedMonthlySavings: 146, risk: Level.HIGH, targetKey: 'UPGRADE_ENGINE' });
      expect(result.drafts[0].title).toContain('postgres 13 is in paid Extended Support');
      expect(result.drafts[0].description).toContain('Blue/Green');
    });

    it('doubles it for Multi-AZ and keeps savings null without price', () => {
      const multi = analyzer.analyze(input({ instance: db({ multiAz: true }), lifecycle: pg13, extendedSupportHourlyPerVcpu: 0.1, prices: { ...PRICES, deployment: 'Multi-AZ' } }));
      expect(multi.analysis.current.extendedSupportMonthlyCost).toBe(292);
      expect(analyzer.analyze(input({ lifecycle: pg13 })).drafts[0].estimatedMonthlySavings).toBeNull();
    });

    it('warns before standard support ends', () => {
      const result = analyzer.analyze(input({ lifecycle: { ...pg13, majorVersion: '14', standardSupportEnd: '2027-02-28T23:59:59.999Z' } }));

      expect(result.drafts).toEqual([]);
      expect(result.analysis.metrics.notes).toContain('postgres 14 leaves standard support in 105 days: plan the upgrade to avoid Extended Support charges');
    });
  });

  it('sums the savings of every opportunity on the same database', () => {
    const result = analyzer.analyze(
      input({
        instance: db({ engineVersion: '13.15', multiAz: true, tags: { Environment: 'qa' } }),
        lifecycle: { engine: 'postgres', majorVersion: '13', standardSupportEnd: '2026-02-28T23:59:59.999Z', extendedSupportEnd: null },
        extendedSupportHourlyPerVcpu: 0.1,
        prices: { deployment: 'Multi-AZ', byClass: { 'db.m6g.large': { monthly: 219, vcpu: 2 } }, singleAz: { monthly: 109.5, vcpu: 2 } },
      }),
    );

    expect(types(result)).toEqual([RecommendationType.RDS_MULTI_AZ, RecommendationType.RDS_EXTENDED_SUPPORT]);
    expect((result.analysis as RdsAnalysis).savings).toEqual({ monthly: 401.5, yearly: 4818, currency: 'USD' });
  });

  it('recommends making a publicly accessible database private', () => {
    const result = analyzer.analyze(input({ instance: db({ publiclyAccessible: true }), prices: { ...PRICES, publicIpv4Monthly: 3.65 } }));

    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toMatchObject({ type: RecommendationType.RDS_PUBLIC_ACCESS, estimatedMonthlySavings: 3.65, severity: Level.MEDIUM, targetKey: 'PRIVATE', title: 'Make RDS orders-prd private' });
    expect(result.drafts[0].description).toContain('--no-publicly-accessible');
  });

  it('leaves idle and Multi-AZ of Aurora members to the cluster, but resizes them', () => {
    const metrics = { ...input().metrics!, connectionsMax: 0 };
    const result = analyzer.analyze(
      input({
        instance: db({ engine: 'aurora-postgresql', clusterId: 'c1', multiAz: true, tags: { env: 'dev' } }),
        metrics,
        optimizer: optimizer({ finding: 'OVER_PROVISIONED', options: [{ instanceClass: 'db.t4g.large', rank: 1, performanceRisk: 1, estimatedMonthlySavings: 14.6 }] }),
      }),
    );
    expect(types(result)).toEqual([RecommendationType.RDS_RIGHTSIZING]);
    expect(result.drafts[0].description).toContain('resize a reader first');
  });

  describe('connection limit of the smaller class', () => {
    const prices = { ...PRICES, byClass: { ...PRICES.byClass, 'db.t4g.medium': { monthly: 47, vcpu: 2, memoryGb: 4 }, 'db.t4g.large': { monthly: 94.9, vcpu: 2, memoryGb: 8 } } };
    const options = [
      { instanceClass: 'db.t4g.medium', rank: 1, performanceRisk: 1, estimatedMonthlySavings: 62 },
      { instanceClass: 'db.t4g.large', rank: 2, performanceRisk: 1, estimatedMonthlySavings: 14 },
    ];
    const run = (connectionsMax: number, over: Partial<RdsAnalyzerInput> = {}) =>
      analyzer.analyze(
        input({ prices, maxConnections: { source: 'DEFAULT' }, metrics: { ...input().metrics!, connectionsMax }, optimizer: optimizer({ finding: 'OVER_PROVISIONED', options, utilization: {} }), ...over }),
      );

    it.each([
      [200, 'db.t4g.medium', Level.MEDIUM],
      [300, 'db.t4g.medium', Level.HIGH],
      [400, 'db.t4g.large', Level.MEDIUM],
    ])('peak of %i connections picks %s with risk %s', (peak, targetKey, risk) => {
      expect(run(peak).drafts[0]).toMatchObject({ type: RecommendationType.RDS_RIGHTSIZING, targetKey, risk });
    });

    it('explains the discarded class and recommends nothing when none fits', () => {
      const result = run(800);
      expect(result.drafts).toEqual([]);
      expect(result.analysis.finding).toBe('OPTIMIZED');
      expect(result.analysis.metrics.notes.filter((n) => n.includes('discarded'))).toHaveLength(2);
    });

    it('blocks earlier in small classes, where AWS reserves much of the memory', () => {
      const micro = { instance: db({ engine: 'mysql', engineVersion: '8.4.3' }), prices: { ...PRICES, byClass: { ...PRICES.byClass, 'db.t4g.micro': { monthly: 12, vcpu: 2, memoryGb: 1 } } }, optimizer: optimizer({ finding: 'OVER_PROVISIONED', options: [{ instanceClass: 'db.t4g.micro', rank: 1, performanceRisk: 1, estimatedMonthlySavings: 90 }], utilization: {} }) };
      expect(run(60, micro).drafts).toEqual([]);
      expect(run(30, micro).drafts).toHaveLength(1);
    });

    it('uses the highest peak between CloudWatch and Compute Optimizer', () => {
      expect(run(10, { optimizer: optimizer({ finding: 'OVER_PROVISIONED', options, utilization: { 'DatabaseConnections Maximum': 400 } }) }).drafts[0].targetKey).toBe('db.t4g.large');
    });

    it('does not block when max_connections is fixed or unknown, and says so', () => {
      expect(run(800, { maxConnections: { source: 'PARAMETER_GROUP', value: '1000' } }).drafts[0].description).toContain('fixed at 1000');
      expect(run(800, { maxConnections: { source: 'PARAMETER_GROUP', value: '{DBInstanceClassMemory/9531392}*2' } }).drafts[0].description).toContain('is unknown');
      expect(run(800, { prices: PRICES }).drafts[0].description).toContain('is unknown');
    });

    it('assumes the default and warns when the parameter group was not read', () => {
      expect(run(400, { maxConnections: { source: 'UNREADABLE' } }).drafts[0]).toMatchObject({ targetKey: 'db.t4g.large', description: expect.stringContaining('engine default assumed') });
    });
  });

  describe('storage', () => {
    const storage = { gbMonth: { gp3: 0.115, io1: 0.125 }, iopsMonth: { io1: 0.1 } };
    const metrics = (over: object) => ({ ...input().metrics!, freeStorageMinGb: 400, freeStorageDatapoints: 336, peakIops: 900, peakThroughputMBps: 40, ...over });

    it('adds storage to the cost and recommends a smaller volume with headroom', () => {
      const result = analyzer.analyze(input({ instance: db({ allocatedStorageGb: 500 }), metrics: metrics({}), prices: { ...PRICES, storage } }));
      expect(result.analysis.current).toMatchObject({ storageMonthlyCost: 57.5, monthlyCost: 167 });
      expect(result.drafts[0]).toMatchObject({ type: RecommendationType.RDS_STORAGE_SHRINK, estimatedMonthlySavings: 42.55, risk: Level.HIGH });
      expect(result.drafts[0].title).toContain('500 GB to 130 GB');
      expect(result.drafts[0].description).toContain('3000 IOPS');
    });

    it('does not shrink below 400 GB when the peak needs the larger gp3 baseline', () => {
      const result = analyzer.analyze(input({ instance: db({ allocatedStorageGb: 500 }), metrics: metrics({ peakIops: 5000 }), prices: { ...PRICES, storage } }));
      expect(result.drafts).toEqual([]);
    });

    it('does not shrink without enough data, without price or for replicas', () => {
      const big = { allocatedStorageGb: 500 };
      for (const over of [
        { instance: db(big), metrics: metrics({ freeStorageDatapoints: 20 }), prices: { ...PRICES, storage } },
        { instance: db(big), metrics: metrics({}), prices: PRICES },
        { instance: db({ ...big, readReplicaSourceId: 'x' }), metrics: metrics({}), prices: { ...PRICES, storage } },
      ]) {
        expect(analyzer.analyze(input(over)).drafts).toEqual([]);
      }
    });

    it('moves io1 to gp3 only when the peak fits the gp3 baseline', () => {
      const instance = db({ storageType: 'io1', allocatedStorageGb: 100, iops: 3000 });
      const fits = analyzer.analyze(input({ instance, metrics: metrics({ freeStorageMinGb: 10 }), prices: { ...PRICES, storage } }));
      expect(fits.drafts[0]).toMatchObject({ type: RecommendationType.RDS_STORAGE_TYPE, estimatedMonthlySavings: 301 });
      const tight = analyzer.analyze(input({ instance, metrics: metrics({ freeStorageMinGb: 10, peakIops: 2900 }), prices: { ...PRICES, storage } }));
      expect(tight.drafts).toEqual([]);
    });
  });

  it('skips Multi-AZ DB cluster members and databases that are not available', () => {
    expect(analyzer.analyze(input({ instance: db({ engine: 'postgres', clusterId: 'c1' }) })).analysis.finding).toBe('NOT_ANALYZED');
    expect(analyzer.analyze(input({ instance: db({ status: 'stopped' }), optimizer: optimizer({ idle: true }) }))).toMatchObject({
      analysis: { finding: 'NOT_AVAILABLE' },
      drafts: [],
    });
  });
});
