import { Level, RecommendationType } from '../../common/enums';
import { NetworkPrices, NetworkResource } from './interfaces/network.interface';
import { NetworkAnalyzerService } from './network-analyzer.service';

const NOW = new Date('2026-11-16T12:00:00Z');
const PRICES: NetworkPrices = { publicIpv4Hourly: 0.005, natGatewayHourly: 0.045, natGatewayPerGb: 0.045, loadBalancerHourly: { application: 0.0225, network: 0.0225 } };
const GB = 1024 ** 3;

const run = (resource: NetworkResource, prices: NetworkPrices | null = PRICES) =>
  new NetworkAnalyzerService().analyze({ resourceId: 'r-1', resourceArn: 'arn:aws:ec2:us-east-1:1:x/r-1', resource, prices, currency: 'USD', now: NOW });

const eip = (associationId: string | null): NetworkResource => ({
  kind: 'EIP',
  eip: { allocationId: 'eipalloc-1', publicIp: '198.51.100.10', region: 'us-east-1', associationId, instanceId: null, networkInterfaceId: null, name: 'old-bastion', tags: {} },
});
const nat = (bytes: number | null, createTime = '2025-01-01T00:00:00Z'): NetworkResource => ({
  kind: 'NAT',
  nat: { natGatewayId: 'nat-1', region: 'us-east-1', vpcId: 'vpc-1', subnetId: 'subnet-1', connectivity: 'public', name: 'nat-hml', tags: {}, createTime, publicIps: ['3.3.3.3'] },
  usage: bytes === null ? null : { periodDays: 14, total: bytes, datapoints: 14 },
});
const lb = (requests: number, type = 'application'): NetworkResource => ({
  kind: 'LB',
  lb: { arn: 'arn:lb', id: 'abc', name: 'old-api', region: 'us-east-1', type, scheme: 'internet-facing', vpcId: 'vpc-1', createdAt: '2025-01-01T00:00:00Z', metricDimension: `${type === 'network' ? 'net' : 'app'}/old-api/abc` },
  usage: { periodDays: 14, total: requests, datapoints: 14 },
  publicIpv4: 2,
});

describe('NetworkAnalyzerService', () => {
  it('releases an Elastic IP that is not associated and leaves associated ones alone', () => {
    const { draft } = run(eip(null));
    expect(draft).toMatchObject({ type: RecommendationType.EIP_UNUSED, estimatedMonthlySavings: 3.65, risk: Level.LOW, title: 'Release unused Elastic IP 198.51.100.10 (old-bastion)', targetKey: 'RELEASE' });
    expect(draft?.description).toContain('DNS record or allow-list');
    expect(run(eip('eipassoc-1')).draft).toBeNull();
  });

  it('deletes a NAT Gateway with less than 1 GB in 14 days, counting hours and its public IPv4', () => {
    const { draft, analysis } = run(nat(0.2 * GB));
    expect(analysis.current.monthlyCost).toBe(36.5);
    expect(draft).toMatchObject({ type: RecommendationType.NAT_GATEWAY_IDLE, estimatedMonthlySavings: 36.5, risk: Level.MEDIUM, recommendedMonthlyCost: 0 });
    expect(draft?.description).toContain('Only 0.2 GB');
    expect(run(nat(50 * GB)).draft).toBeNull();
  });

  it('never calls a NAT idle without metrics or right after creation', () => {
    expect(run(nat(null)).analysis.finding).toBe('INSUFFICIENT_DATA');
    expect(run(nat(0, '2026-11-14T00:00:00Z')).draft).toBeNull();
  });

  it('deletes load balancers without traffic and prices hours plus public IPv4', () => {
    const { draft } = run(lb(0));
    expect(draft).toMatchObject({ type: RecommendationType.LOAD_BALANCER_IDLE, estimatedMonthlySavings: 23.73, title: 'Delete idle application load balancer old-api', service: 'elasticloadbalancing' });
    expect(draft?.description).toContain('No requests in 14 days');
    expect(run(lb(0, 'network')).draft?.description).toContain('No new connections');
    expect(run(lb(186168)).draft).toBeNull();
  });

  it('suggests free gateway endpoints for a VPC with NAT and no S3 endpoint, without inventing savings', () => {
    const vpc = (endpoints: string[], natGatewayIds = ['nat-1']): NetworkResource => ({ kind: 'VPC', vpcId: 'vpc-1', region: 'us-east-1', natGatewayIds, natProcessedGb: 120, gatewayEndpoints: endpoints });
    const { draft } = run(vpc([]));
    expect(draft).toMatchObject({ type: RecommendationType.VPC_ENDPOINT_MISSING, estimatedMonthlySavings: null, title: 'Add free S3 and DynamoDB gateway endpoint to VPC vpc-1' });
    expect(draft?.description).toContain('processed 120 GB in 14 days (USD 5.4)');
    expect(run(vpc(['s3'])).draft).toBeNull();
    expect(run(vpc([], [])).draft).toBeNull();
  });

  it('keeps savings null when prices are unknown', () => {
    expect(run(eip(null), null).draft?.estimatedMonthlySavings).toBeNull();
    expect(run(nat(0), null).draft?.estimatedMonthlySavings).toBeNull();
  });
});
