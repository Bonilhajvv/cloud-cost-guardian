import { AuditService } from '../audit/audit.service';
import { AwsAccountsService } from '../aws-accounts/aws-accounts.service';
import { AwsAccount } from '../aws-accounts/entities/aws-account.entity';
import { EbsAnalyzerService } from '../aws/ebs/ebs-analyzer.service';
import { EbsService } from '../aws/ebs/ebs.service';
import { Ec2AnalyzerService } from '../aws/ec2/ec2-analyzer.service';
import { Ec2Service } from '../aws/ec2/ec2.service';
import { Ec2InstanceDetails } from '../aws/ec2/interfaces/ec2-instance.interface';
import { CloudWatchService } from '../aws/metrics/cloudwatch.service';
import { MEMORY_UNAVAILABLE } from '../aws/metrics/interfaces/utilization-metrics.interface';
import { ComputeOptimizerService } from '../aws/optimizer/compute-optimizer.service';
import { PricingService } from '../aws/pricing/pricing.service';
import { ResourceExplorerService } from '../aws/resources/resource-explorer.service';
import { AuditAction, AwsAccountStatus, RecommendationType } from '../common/enums';
import { CostReportsService } from '../cost-reports/cost-reports.service';
import { CostSyncService } from '../cost-reports/cost-sync.service';
import { AdvisoryLockService } from '../database/advisory-lock.service';
import { LockResult } from '../database/interfaces/lock-result.interface';
import { KubernetesMetricsService } from '../kubernetes/kubernetes-metrics.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { AwsResource } from '../resource-inventory/entities/aws-resource.entity';
import { AwsResourceMetadata } from '../resource-inventory/interfaces/aws-resource-metadata.interface';
import { ResourceInventoryService } from '../resource-inventory/resource-inventory.service';
import { FULL_SCAN_STEPS } from './constants/scan.constant';
import { ScanOrchestratorService } from './scan-orchestrator.service';

const ARN = 'arn:aws:ec2:sa-east-1:111122223333:instance/i-123';

const account = {
  id: 'acc-1',
  organizationId: 'org-1',
  awsAccountId: '111122223333',
  roleArn: 'arn:aws:iam::111122223333:role/CloudCostGuardianReadOnly',
  externalId: 'ext',
  defaultRegion: 'sa-east-1',
  regions: [],
  status: AwsAccountStatus.CONNECTED,
} as unknown as AwsAccount;

const instance: Ec2InstanceDetails = {
  instanceId: 'i-123',
  arn: ARN,
  name: 'production-api',
  instanceType: 'm6i.xlarge',
  state: 'running',
  region: 'sa-east-1',
  availabilityZone: 'sa-east-1a',
  platform: 'Linux/UNIX',
  architecture: 'x86_64',
  launchTime: null,
  tags: { Name: 'production-api' },
  volumeIds: [],
  vcpu: 4,
  memoryGiB: 16,
};

function build() {
  const store = new Map<string, AwsResourceMetadata>();
  const inventory = {
    upsertDiscovered: jest.fn().mockResolvedValue(1),
    removeStale: jest.fn().mockResolvedValue(0),
    patchMetadata: jest.fn(async (_acc: string, id: string, patch: AwsResourceMetadata) => {
      store.set(id, { ...(store.get(id) ?? {}), ...patch });
    }),
    findEc2Instances: jest.fn(async () =>
      [...store.entries()].filter(([, m]) => m.ec2).map(([resourceId, metadata]) => ({ resourceId, region: 'sa-east-1', metadata }) as AwsResource),
    ),
    findByType: jest.fn(async (_acc: string, type: string) =>
      [...store.entries()]
        .filter(([, m]) => (type === 'ec2:volume' ? m.ebs : m.ec2))
        .map(([resourceId, metadata]) => ({ resourceId, region: 'sa-east-1', metadata }) as AwsResource),
    ),
  };
  const deps = {
    accounts: { markSynced: jest.fn(), markError: jest.fn() },
    inventory,
    resourceExplorer: {
      discover: jest.fn().mockResolvedValue({
        mode: 'AGGREGATOR',
        failures: [],
        resources: [
          { arn: ARN, resourceId: 'i-123', service: 'ec2', resourceType: 'ec2:instance', region: 'sa-east-1', tags: {} },
          { arn: 'arn:aws:s3:::logs', resourceId: 'logs', service: 's3', resourceType: 's3:bucket', region: 'global', tags: {} },
        ],
      }),
    },
    ec2: {
      listInstances: jest.fn().mockResolvedValue([instance]),
      describeInstanceTypes: jest.fn(async (_a: unknown, _r: string, types: string[]) =>
        new Map(types.filter((t) => t === 'm6i.large').map((t) => [t, { instanceType: t, vcpu: 2, memoryGiB: 8, architectures: ['x86_64'] }])),
      ),
      listEnabledRegions: jest.fn(),
    },
    cloudWatch: {
      getEbsUtilization: jest.fn().mockResolvedValue(new Map()),
      getEc2Utilization: jest.fn().mockResolvedValue(
        new Map([
          [
            'i-123',
            {
              periodDays: 14,
              collectedAt: new Date().toISOString(),
              cpu: { average: 21, p95: 38, max: 55, datapoints: 336 },
              networkInBytesPerDay: 1e9,
              networkOutBytesPerDay: 1e9,
              memory: { available: false, reason: MEMORY_UNAVAILABLE },
            },
          ],
        ]),
      ),
    },
    optimizer: {
      getEc2Recommendations: jest.fn().mockResolvedValue({
        availability: 'OK',
        recommendations: [
          {
            instanceArn: ARN,
            instanceId: 'i-123',
            currentInstanceType: 'm6i.xlarge',
            finding: 'OVER_PROVISIONED',
            lookBackPeriodDays: 14,
            lastRefreshedAt: null,
            options: [{ instanceType: 'm6i.large', rank: 1, performanceRisk: 1, estimatedMonthlySavings: 54, savingsPercentage: 39.13, currency: 'USD', spec: null }],
          },
        ],
      }),
    },
    pricing: {
      pricingOs: jest.fn(() => 'Linux'),
      getEc2MonthlyPrices: jest.fn().mockResolvedValue({ 'm6i.xlarge': 140.16, 'm6i.large': 70.08 }),
      getEbsMonthlyPricePerGb: jest.fn().mockResolvedValue({ gp2: 0.1, gp3: 0.08 }),
    },
    ebs: {
      listVolumes: jest.fn().mockResolvedValue([
        { volumeId: 'vol-1', arn: 'arn:aws:ec2:sa-east-1:111122223333:volume/vol-1', name: null, volumeType: 'gp2', sizeGiB: 100, iops: 300, throughputMBps: null, state: 'available', attachedInstanceIds: [], createTime: '2025-01-01T00:00:00.000Z', region: 'sa-east-1', availabilityZone: 'sa-east-1a', encrypted: true, tags: {} },
      ]),
    },
    ebsAnalyzer: new EbsAnalyzerService(),
    analyzer: new Ec2AnalyzerService(),
    costSync: { syncAccount: jest.fn().mockResolvedValue({ monthlyLines: 1 }) },
    costReports: { monthlyEstimatesByResource: jest.fn().mockResolvedValue(new Map([['i-123', 138]])) },
    recommendations: { syncDrafts: jest.fn().mockResolvedValue({ created: 1, updated: 0, resolved: 0, skipped: 0 }) },
    locks: { tryWithLock: jest.fn(async (_k: string, fn: () => Promise<unknown>): Promise<LockResult<unknown>> => ({ acquired: true, value: await fn() })) },
    audit: { log: jest.fn() },
    kubernetesMetrics: { nodeMemoryStats: jest.fn().mockResolvedValue(new Map()) },
  };
  const orchestrator = new ScanOrchestratorService(
    deps.accounts as unknown as AwsAccountsService,
    deps.inventory as unknown as ResourceInventoryService,
    deps.resourceExplorer as unknown as ResourceExplorerService,
    deps.ec2 as unknown as Ec2Service,
    deps.cloudWatch as unknown as CloudWatchService,
    deps.optimizer as unknown as ComputeOptimizerService,
    deps.pricing as unknown as PricingService,
    deps.analyzer,
    deps.ebs as unknown as EbsService,
    deps.ebsAnalyzer,
    deps.costSync as unknown as CostSyncService,
    deps.costReports as unknown as CostReportsService,
    deps.recommendations as unknown as RecommendationsService,
    deps.locks as unknown as AdvisoryLockService,
    deps.audit as unknown as AuditService,
    deps.kubernetesMetrics as unknown as KubernetesMetricsService,
  );
  return { orchestrator, deps, store };
}

describe('ScanOrchestratorService (EC2 end-to-end flow)', () => {
  it('runs Resource Explorer -> EC2 -> CloudWatch -> Cost -> Compute Optimizer -> Analyzer -> Recommendation', async () => {
    const { orchestrator, deps, store } = build();

    const report = await orchestrator.run(account, FULL_SCAN_STEPS, 'MANUAL', 'user-1');

    expect(report.status).toBe('FINISHED');
    expect(report.steps.map((s) => [s.step, s.status])).toEqual([
      ['RESOURCES', 'OK'],
      ['COSTS', 'OK'],
      ['OPTIMIZER', 'OK'],
      ['ANALYSIS', 'OK'],
    ]);
    expect(deps.ec2.listInstances).toHaveBeenCalledWith(account, 'sa-east-1', ['i-123']);
    expect(deps.cloudWatch.getEc2Utilization).toHaveBeenCalledWith(account, 'sa-east-1', [instance], 14);
    expect(deps.ebs.listVolumes).toHaveBeenCalledWith(account, 'sa-east-1');
    expect(deps.accounts.markSynced).toHaveBeenCalledWith('acc-1', 'lastScanAt', { regions: ['sa-east-1'] });

    const analysis = store.get('i-123')?.analysis;
    expect(analysis).toMatchObject({
      finding: 'RIGHTSIZE',
      current: { instanceType: 'm6i.xlarge', monthlyCost: 138 },
      recommendation: { instanceType: 'm6i.large', vcpu: 2, memoryGb: 8 },
      savings: { monthly: 54, yearly: 648 },
    });

    const [, types, drafts, resolveMissing] = deps.recommendations.syncDrafts.mock.calls[0];
    expect(types).toEqual([RecommendationType.EC2_RIGHTSIZING, RecommendationType.EC2_IDLE]);
    expect(drafts).toHaveLength(1);
    expect(resolveMissing).toBe(true);

    const [, ebsTypes, ebsDrafts] = deps.recommendations.syncDrafts.mock.calls[1];
    expect(ebsTypes).toEqual([RecommendationType.EBS_UNUSED, RecommendationType.EBS_OPTIMIZATION]);
    expect(ebsDrafts).toMatchObject([{ type: RecommendationType.EBS_UNUSED, estimatedMonthlySavings: 10 }]);

    const actions = deps.audit.log.mock.calls.map(([e]: [{ action: AuditAction }]) => e.action);
    expect(actions).toEqual([AuditAction.SCAN_STARTED, AuditAction.SCAN_FINISHED]);
  });

  it('stops and marks the account as ERROR when the resource step fails', async () => {
    const { orchestrator, deps } = build();
    deps.resourceExplorer.discover.mockRejectedValue(Object.assign(new Error('not authorized'), { name: 'AccessDenied' }));

    const report = await orchestrator.run(account, FULL_SCAN_STEPS, 'SCHEDULED');

    expect(report.status).toBe('FAILED');
    expect(report.steps).toHaveLength(1);
    expect(deps.accounts.markError).toHaveBeenCalledWith('acc-1', expect.stringContaining('ACCESS_DENIED'));
    expect(deps.costSync.syncAccount).not.toHaveBeenCalled();
    expect(deps.audit.log.mock.calls.at(-1)[0].action).toBe(AuditAction.SCAN_FAILED);
  });

  it('keeps going when a non-fatal step fails', async () => {
    const { orchestrator, deps } = build();
    deps.costSync.syncAccount.mockRejectedValue(Object.assign(new Error('slow down'), { name: 'ThrottlingException' }));

    const report = await orchestrator.run(account, FULL_SCAN_STEPS, 'SCHEDULED');

    expect(report.status).toBe('FINISHED');
    expect(report.steps.find((s) => s.step === 'COSTS')).toMatchObject({ status: 'FAILED', error: expect.stringContaining('THROTTLED') });
    expect(deps.recommendations.syncDrafts).toHaveBeenCalled();
  });

  it('does not remove stale resources when a region failed', async () => {
    const { orchestrator, deps } = build();
    deps.cloudWatch.getEc2Utilization.mockRejectedValue(new Error('timeout'));

    await orchestrator.scanResources(account);

    expect(deps.inventory.removeStale).not.toHaveBeenCalled();
  });

  it('skips when another pod holds the account lock', async () => {
    const { orchestrator, deps } = build();
    deps.locks.tryWithLock.mockResolvedValue({ acquired: false });

    const report = await orchestrator.run(account, FULL_SCAN_STEPS, 'SCHEDULED');

    expect(report.status).toBe('SKIPPED_LOCKED');
    expect(deps.resourceExplorer.discover).not.toHaveBeenCalled();
  });
});
