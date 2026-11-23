import { Level, RecommendationType } from '../../common/enums';
import { AuroraAnalyzerService } from './aurora-analyzer.service';
import { RdsBackupAnalyzerService } from './rds-backup-analyzer.service';
import { AuroraAnalyzerInput, AuroraMember } from './interfaces/aurora.interface';

const ARN = 'arn:aws:rds:us-east-1:111122223333:cluster:orders';
const metrics = (connectionsMax: number, connectionsDatapoints = 336) =>
  ({ periodDays: 14, collectedAt: '', cpu: { average: 1, p95: 1, max: 1, datapoints: 336 }, connectionsMax, connectionsDatapoints }) as AuroraMember['metrics'];
const member = (id: string, writer: boolean, connections: number, over: Partial<AuroraMember> = {}): AuroraMember => ({
  dbInstanceId: id,
  writer,
  arn: `arn:${id}`,
  instanceClass: 'db.r6g.large',
  status: 'available',
  metrics: metrics(connections),
  capacity: null,
  ...over,
});

function input(over: Partial<AuroraAnalyzerInput> = {}): AuroraAnalyzerInput {
  return {
    cluster: { clusterId: 'orders', arn: ARN, region: 'us-east-1', engine: 'aurora-postgresql', engineVersion: '16.4', status: 'available', ioOptimized: false, serverlessMinCapacity: null, serverlessMaxCapacity: null, backupRetentionDays: 7, members: [], tags: {} },
    members: [member('w', true, 20), member('r', false, 5)],
    usage: { periodDays: 14, storageGb: 100, monthlyIoRequests: 1_000_000 },
    prices: {
      standard: { byClass: { 'db.r6g.large': { monthly: 189.8, vcpu: 2 } }, acuHour: 0.12, storageGbMonth: 0.1 },
      ioOptimized: { byClass: { 'db.r6g.large': { monthly: 246.74, vcpu: 2 } }, acuHour: 0.16, storageGbMonth: 0.225 },
      ioRequest: 0.0000002,
    },
    currency: 'USD',
    ...over,
  };
}

describe('AuroraAnalyzerService', () => {
  const analyzer = new AuroraAnalyzerService();

  it('leaves a used cluster alone and prices instances, storage and I/O', () => {
    const { analysis, drafts } = analyzer.analyze(input());
    expect(drafts).toEqual([]);
    expect(analysis).toMatchObject({ finding: 'OPTIMIZED', resourceId: ARN, current: { monthlyCost: 389.8 } });
  });

  it('flags the idle reader, with more risk when it is the only failover target', () => {
    const { drafts } = analyzer.analyze(input({ members: [member('w', true, 20), member('r', false, 0)] }));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ type: RecommendationType.AURORA_READER_IDLE, resourceId: 'r', resourceArn: 'arn:r', estimatedMonthlySavings: 189.8, currentMonthlyCost: 189.8, risk: Level.HIGH });
    const two = analyzer.analyze(input({ members: [member('w', true, 20), member('r', false, 0), member('r2', false, 9)] }));
    expect(two.drafts[0].risk).toBe(Level.MEDIUM);
  });

  it('flags the whole cluster when nobody connects, but not with little data', () => {
    const idle = analyzer.analyze(input({ members: [member('w', true, 0), member('r', false, 0)] }));
    expect(idle.drafts.map((d) => [d.type, d.estimatedMonthlySavings])).toEqual([[RecommendationType.AURORA_CLUSTER_IDLE, 379.6]]);
    expect(analyzer.analyze(input({ members: [member('w', true, 0, { metrics: metrics(0, 20) })] })).drafts).toEqual([]);
  });

  it('moves to I/O-Optimized when I/O dominates and back when it does not', () => {
    const heavy = analyzer.analyze(input({ usage: { periodDays: 14, storageGb: 100, monthlyIoRequests: 2_000_000_000 } }));
    expect(heavy.drafts[0]).toMatchObject({ type: RecommendationType.AURORA_STORAGE_MODE, targetKey: 'IO_OPTIMIZED', estimatedMonthlySavings: 273.62 });
    const light = input();
    const back = analyzer.analyze({ ...light, cluster: { ...light.cluster, ioOptimized: true } });
    expect(back.drafts[0]).toMatchObject({ targetKey: 'STANDARD', estimatedMonthlySavings: 126.18 });
    expect(analyzer.analyze(input({ usage: { periodDays: 14, storageGb: 100, monthlyIoRequests: null } })).drafts).toEqual([]);
  });

  it('suggests a lower minimum capacity without inventing the saving', () => {
    const base = input();
    const serverless = member('w', true, 9, { instanceClass: 'db.serverless', capacity: { timestamps: [], values: Array(336).fill(2) } });
    const { drafts } = analyzer.analyze({ ...base, cluster: { ...base.cluster, serverlessMinCapacity: 2 }, members: [serverless] });
    expect(drafts[0]).toMatchObject({ type: RecommendationType.AURORA_SERVERLESS_MIN_CAPACITY, estimatedMonthlySavings: null });
    expect(drafts[0].description).toContain('at most USD 131.4/month');
  });
});

describe('RdsBackupAnalyzerService', () => {
  const analyzer = new RdsBackupAnalyzerService();
  const cost = { region: 'us-east-1', monthlyCost: 42.5, gbMonth: 447 };

  it('reports the excess and its causes, with an unknown saving', () => {
    const { drafts } = analyzer.analyze({ cost, sources: [{ id: 'prd', retentionDays: 35, nonProduction: false }, { id: 'dev', retentionDays: 14, nonProduction: true }], oldManualSnapshots: 2, currency: 'USD' });
    expect(drafts[0]).toMatchObject({ type: RecommendationType.RDS_BACKUP_EXCESS, resourceId: 'rds-backup/us-east-1', currentMonthlyCost: 42.5, estimatedMonthlySavings: null });
    expect(drafts[0].description).toContain('dev (14 days, non-production), prd (35 days)');
  });

  it('stays quiet without a cause or below the threshold', () => {
    expect(analyzer.analyze({ cost, sources: [{ id: 'a', retentionDays: 7, nonProduction: false }], oldManualSnapshots: 0, currency: 'USD' }).drafts).toEqual([]);
    expect(analyzer.analyze({ cost: { ...cost, monthlyCost: 1 }, sources: [], oldManualSnapshots: 5, currency: 'USD' }).drafts).toEqual([]);
  });
});
