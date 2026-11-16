import { CloudWatchService } from '../aws/metrics/cloudwatch.service';
import { NetworkAnalyzerService } from '../aws/network/network-analyzer.service';
import { NetworkService } from '../aws/network/network.service';
import { PricingService } from '../aws/pricing/pricing.service';
import { AwsAccountsService } from '../aws-accounts/aws-accounts.service';
import { AwsAccount } from '../aws-accounts/entities/aws-account.entity';
import { RecommendationType } from '../common/enums';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { AwsResource } from '../resource-inventory/entities/aws-resource.entity';
import { AwsResourceMetadata } from '../resource-inventory/interfaces/aws-resource-metadata.interface';
import { ResourceInventoryService } from '../resource-inventory/resource-inventory.service';
import { NetworkScanService } from './network-scan.service';

const account = { id: 'acc-1', organizationId: 'org-1', awsAccountId: '111122223333' } as AwsAccount;

function build() {
  const store = new Map<string, { type: string; arn: string; metadata: AwsResourceMetadata }>();
  const deps = {
    inventory: {
      upsertDiscovered: jest.fn(async (_a: unknown, rows: { resourceId: string; resourceType: string; arn: string }[]) => {
        for (const r of rows) store.set(r.resourceId, { type: r.resourceType, arn: r.arn, metadata: store.get(r.resourceId)?.metadata ?? {} });
        return rows.length;
      }),
      patchMetadata: jest.fn(async (_a: string, _t: string, id: string, patch: AwsResourceMetadata) => {
        const row = store.get(id);
        if (row) row.metadata = { ...row.metadata, ...patch };
      }),
      findByType: jest.fn(async (_a: string, type: string) =>
        [...store.entries()].filter(([, r]) => r.type === type).map(([resourceId, r]) => ({ resourceId, resourceType: r.type, arn: r.arn, metadata: r.metadata }) as AwsResource),
      ),
    },
    network: {
      listElasticIps: jest.fn().mockResolvedValue([
        { allocationId: 'eipalloc-free', publicIp: '9.9.9.9', region: 'us-east-1', associationId: null, instanceId: null, networkInterfaceId: null, name: null, tags: {} },
      ]),
      listNatGateways: jest.fn().mockResolvedValue([
        { natGatewayId: 'nat-1', region: 'us-east-1', vpcId: 'vpc-1', subnetId: 's', connectivity: 'public', name: null, tags: {}, createTime: '2025-01-01T00:00:00Z', publicIps: ['3.3.3.3'] },
      ]),
      listLoadBalancers: jest.fn().mockResolvedValue([
        { arn: 'arn:lb', id: 'abc', name: 'api', region: 'us-east-1', type: 'application', scheme: 'internet-facing', vpcId: 'vpc-1', createdAt: '2025-01-01T00:00:00Z', metricDimension: 'app/api/abc' },
      ]),
      gatewayEndpointsByVpc: jest.fn().mockResolvedValue(new Map()),
      publicNetworkInterfaces: jest.fn().mockResolvedValue([
        { Description: 'ELB app/api/abc', NetworkInterfaceId: 'eni-1', PrivateIpAddresses: [{ Association: { PublicIp: '1.1.1.1' } }] },
        { Description: 'Primary network interface', Attachment: { InstanceId: 'i-1' }, NetworkInterfaceId: 'eni-2', PrivateIpAddresses: [{ Association: { PublicIp: '2.2.2.2' } }] },
      ]),
    },
    cloudWatch: {
      getMetricSums: jest.fn().mockResolvedValue(new Map([['nat-1', { periodDays: 14, total: 5 * 1024 ** 3, datapoints: 14 }], ['abc', { periodDays: 14, total: 0, datapoints: 14 }]])),
    },
    pricing: { getNetworkPrices: jest.fn().mockResolvedValue({ publicIpv4Hourly: 0.005, natGatewayHourly: 0.045, natGatewayPerGb: 0.045, loadBalancerHourly: { application: 0.0225 } }) },
    accounts: { saveNetwork: jest.fn() },
    recommendations: { syncDrafts: jest.fn().mockResolvedValue({ created: 3, updated: 0, resolved: 0, skipped: 0 }) },
  };
  const service = new NetworkScanService(
    deps.inventory as unknown as ResourceInventoryService,
    deps.network as unknown as NetworkService,
    new NetworkAnalyzerService(),
    deps.cloudWatch as unknown as CloudWatchService,
    deps.pricing as unknown as PricingService,
    deps.accounts as unknown as AwsAccountsService,
    deps.recommendations as unknown as RecommendationsService,
  );
  return { service, deps, store };
}

describe('NetworkScanService', () => {
  it('inventories network resources, the public IPv4 of the account and recommends cleanups', async () => {
    const { service, deps, store } = build();

    const details = await service.scan(account, ['us-east-1'], new Date('2026-11-16T00:00:00Z'));
    expect(details).toMatchObject({ elasticIps: 1, natGateways: 1, loadBalancers: 1, publicIpv4: 3, unavailable: [] });
    expect(deps.accounts.saveNetwork).toHaveBeenCalledWith('acc-1', expect.objectContaining({ publicIpv4Hourly: 0.005 }));
    expect(store.get('abc')?.metadata.network).toMatchObject({ kind: 'LB', publicIpv4: 1 });
    expect(store.get('vpc-1')?.metadata.network).toMatchObject({ kind: 'VPC', natGatewayIds: ['nat-1'], natProcessedGb: 5 });

    await service.analyze(account);
    const drafts = deps.recommendations.syncDrafts.mock.calls[0][2].map((d: { type: RecommendationType }) => d.type).sort();
    expect(drafts).toEqual([RecommendationType.EIP_UNUSED, RecommendationType.LOAD_BALANCER_IDLE, RecommendationType.VPC_ENDPOINT_MISSING].sort());
  });

  it('keeps going without the network data the role cannot read and does not overwrite the IPv4 inventory', async () => {
    const { service, deps } = build();
    const denied = Object.assign(new Error('no'), { name: 'UnauthorizedOperation' });
    deps.network.publicNetworkInterfaces.mockRejectedValue(denied);
    deps.network.listLoadBalancers.mockRejectedValue(Object.assign(new Error('no'), { name: 'AccessDenied' }));

    const details = await service.scan(account, ['us-east-1'], new Date());
    expect(details.failures).toEqual([]);
    expect(details.unavailable.sort()).toEqual(['DescribeLoadBalancers', 'DescribeNetworkInterfaces']);
    expect(deps.accounts.saveNetwork).not.toHaveBeenCalled();
  });
});
