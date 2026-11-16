import { CloudWatchService } from '../aws/metrics/cloudwatch.service';
import { ComputeOptimizerService } from '../aws/optimizer/compute-optimizer.service';
import { PricingService } from '../aws/pricing/pricing.service';
import { RdsAnalyzerService } from '../aws/rds/rds-analyzer.service';
import { RdsService } from '../aws/rds/rds.service';
import { AwsAccount } from '../aws-accounts/entities/aws-account.entity';
import { RecommendationType } from '../common/enums';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { AwsResource } from '../resource-inventory/entities/aws-resource.entity';
import { AwsResourceMetadata } from '../resource-inventory/interfaces/aws-resource-metadata.interface';
import { ResourceInventoryService } from '../resource-inventory/resource-inventory.service';
import { RdsScanService } from './rds-scan.service';

const account = { id: 'acc-1', organizationId: 'org-1', awsAccountId: '111122223333' } as AwsAccount;
const database = {
  dbInstanceId: 'legacy-hml',
  arn: 'arn:aws:rds:us-east-1:111122223333:db:legacy-hml',
  region: 'us-east-1',
  instanceClass: 'db.m6g.large',
  engine: 'postgres',
  engineVersion: '13.15',
  multiAz: true,
  storageType: 'gp3',
  allocatedStorageGb: 50,
  status: 'available',
  clusterId: null,
  readReplicaSourceId: null,
  replicaIds: [],
  tags: { Environment: 'hml' },
  createTime: null,
};

function build() {
  const store = new Map<string, AwsResourceMetadata>();
  const deps = {
    inventory: {
      upsertDiscovered: jest.fn().mockResolvedValue(1),
      patchMetadata: jest.fn(async (_a: string, _t: string, id: string, patch: AwsResourceMetadata) => {
        store.set(id, { ...(store.get(id) ?? {}), ...patch });
      }),
      findByType: jest.fn(async () => [...store.entries()].map(([resourceId, metadata]) => ({ resourceId, resourceType: 'rds:db', region: 'us-east-1', metadata }) as AwsResource)),
    },
    rds: {
      listInstances: jest.fn().mockResolvedValue([database]),
      engineLifecycles: jest.fn().mockResolvedValue([{ engine: 'postgres', majorVersion: '13', standardSupportEnd: '2026-02-28T23:59:59.999Z', extendedSupportEnd: '2029-02-28T23:59:59.999Z' }]),
    },
    cloudWatch: {
      getRdsUtilization: jest.fn().mockResolvedValue(
        new Map([['legacy-hml', { periodDays: 14, collectedAt: '', cpu: { average: 5, p95: 9, max: 20, datapoints: 336 }, connectionsMax: 4, connectionsDatapoints: 336 }]]),
      ),
    },
    optimizer: {
      getRdsRecommendations: jest.fn().mockResolvedValue({
        availability: 'OK',
        recommendations: [
          {
            resourceArn: database.arn,
            dbInstanceId: 'legacy-hml',
            currentInstanceClass: 'db.m6g.large',
            finding: 'OVER_PROVISIONED',
            idle: false,
            lookBackPeriodDays: 14,
            options: [{ instanceClass: 'db.t4g.large', rank: 1, performanceRisk: 1, estimatedMonthlySavings: 40 }],
            utilization: {},
          },
        ],
      }),
    },
    pricing: {
      getRdsInstancePrices: jest.fn(async (_r: string, _e: string, deployment: string, classes: string[]) =>
        Object.fromEntries(classes.map((c) => [c, { monthly: (deployment === 'Multi-AZ' ? 2 : 1) * (c === 'db.m6g.large' ? 109.5 : 94.9), vcpu: 2 }])),
      ),
      getRdsExtendedSupportHourlyPerVcpu: jest.fn().mockResolvedValue(0.1),
      getNetworkPrices: jest.fn().mockResolvedValue({ publicIpv4Hourly: 0.005, natGatewayHourly: 0.045, natGatewayPerGb: 0.045, loadBalancerHourly: {} }),
    },
    recommendations: { syncDrafts: jest.fn().mockResolvedValue({ created: 3, updated: 0, resolved: 0, skipped: 0 }) },
  };
  const service = new RdsScanService(
    deps.inventory as unknown as ResourceInventoryService,
    deps.rds as unknown as RdsService,
    new RdsAnalyzerService(),
    deps.cloudWatch as unknown as CloudWatchService,
    deps.optimizer as unknown as ComputeOptimizerService,
    deps.pricing as unknown as PricingService,
    deps.recommendations as unknown as RecommendationsService,
  );
  return { service, deps, store };
}

describe('RdsScanService', () => {
  it('discovers, prices, asks Compute Optimizer and turns the analysis into recommendations', async () => {
    const { service, deps, store } = build();

    expect(await service.scan(account, ['us-east-1'], new Date())).toEqual({ databases: 1, failures: [] });
    expect(store.get('legacy-hml')).toMatchObject({
      rdsPrices: { deployment: 'Multi-AZ', byClass: { 'db.m6g.large': { monthly: 219 } }, singleAz: { monthly: 109.5 } },
      rdsLifecycle: { majorVersion: '13' },
      rdsExtendedSupportHourlyPerVcpu: 0.1,
    });
    expect(deps.pricing.getRdsExtendedSupportHourlyPerVcpu).toHaveBeenCalledWith('us-east-1', 'postgres', '13', 'Year 1, Year 2');

    await service.syncOptimizer(account);
    expect(store.get('legacy-hml')?.rdsPrices?.byClass['db.t4g.large']).toEqual({ monthly: 189.8, vcpu: 2 });

    const details = await service.analyze(account);
    const [, types, drafts] = deps.recommendations.syncDrafts.mock.calls[0];
    expect(types).toContain(RecommendationType.RDS_EXTENDED_SUPPORT);
    expect(drafts.map((d: { type: RecommendationType }) => d.type)).toEqual([
      RecommendationType.RDS_RIGHTSIZING,
      RecommendationType.RDS_MULTI_AZ,
      RecommendationType.RDS_EXTENDED_SUPPORT,
    ]);
    expect(details).toMatchObject({ analyzed: 1, findings: { RIGHTSIZE: 1 }, created: 3 });
  });

  it('treats a role without RDS permissions as no databases instead of a failed region', async () => {
    const { service, deps } = build();
    deps.rds.listInstances.mockRejectedValue(Object.assign(new Error('not authorized'), { name: 'AccessDeniedException' }));

    expect(await service.scan(account, ['us-east-1'], new Date())).toEqual({ databases: 0, failures: [] });
    expect(deps.inventory.upsertDiscovered).not.toHaveBeenCalled();
  });

  it('keeps analyzing when the engine lifecycle API fails', async () => {
    const { service, deps, store } = build();
    deps.rds.engineLifecycles.mockRejectedValue(new Error('throttled'));

    await service.scan(account, ['us-east-1'], new Date());
    expect(store.get('legacy-hml')).toMatchObject({ rdsLifecycle: null, rdsExtendedSupportHourlyPerVcpu: null });
  });
});
