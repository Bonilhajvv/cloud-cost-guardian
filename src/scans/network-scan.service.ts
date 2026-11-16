import { Injectable, Logger } from '@nestjs/common';
import { toAwsIntegrationError } from '../aws/core/errors/aws-integration.error';
import { forEachRegion } from '../aws/core/helpers/region-runner.helper';
import { RecommendationDraft, ResourceAnalysis } from '../aws/core/interfaces/recommendation-draft.interface';
import { CloudWatchService } from '../aws/metrics/cloudwatch.service';
import { MetricSumQuery } from '../aws/metrics/interfaces/metric-sum-query.interface';
import { GIB_BYTES, LOAD_BALANCER_METRICS } from '../aws/network/constants/network.constant';
import { publicIpv4Of } from '../aws/network/helpers/normalize-network.helper';
import { NetworkResource, PublicIpv4 } from '../aws/network/interfaces/network.interface';
import { NetworkAnalyzerService } from '../aws/network/network-analyzer.service';
import { NetworkService } from '../aws/network/network.service';
import { PricingService } from '../aws/pricing/pricing.service';
import { AwsResourceData } from '../aws/resources/interfaces/aws-resource-data.interface';
import { AwsAccountsService } from '../aws-accounts/aws-accounts.service';
import { AwsAccount } from '../aws-accounts/entities/aws-account.entity';
import { NETWORK_RECOMMENDATION_TYPES } from '../recommendations/constants/recommendation.constant';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { NETWORK_RESOURCE_TYPES } from '../resource-inventory/constants/resource-types.constant';
import { ResourceInventoryService } from '../resource-inventory/resource-inventory.service';
import { DEFAULT_CURRENCY, METRICS_PERIOD_DAYS } from './constants/scan.constant';
import { AnalysisDetails, NetworkScanDetails } from './interfaces/scan-report.interface';

@Injectable()
export class NetworkScanService {
  private readonly logger = new Logger(NetworkScanService.name);

  constructor(
    private readonly inventory: ResourceInventoryService,
    private readonly network: NetworkService,
    private readonly analyzer: NetworkAnalyzerService,
    private readonly cloudWatch: CloudWatchService,
    private readonly pricing: PricingService,
    private readonly accounts: AwsAccountsService,
    private readonly recommendations: RecommendationsService,
  ) {}

  async scan(account: AwsAccount, regions: readonly string[], seenAt: Date): Promise<NetworkScanDetails> {
    const unavailable = new Set<string>();
    const run = await forEachRegion([...regions], (region) => this.enrichRegion(account, region, seenAt, unavailable));
    const results = run.results.map((r) => r.value);
    const publicIpv4 = results.flatMap((r) => r.publicIpv4);
    const hourly = results.find((r) => r.publicIpv4Hourly !== null)?.publicIpv4Hourly ?? null;
    if (!unavailable.has('DescribeNetworkInterfaces') && run.failures.length === 0) {
      await this.accounts.saveNetwork(account.id, { fetchedAt: seenAt.toISOString(), publicIpv4, publicIpv4Hourly: hourly });
    }
    return {
      elasticIps: results.reduce((s, r) => s + r.elasticIps, 0),
      natGateways: results.reduce((s, r) => s + r.natGateways, 0),
      loadBalancers: results.reduce((s, r) => s + r.loadBalancers, 0),
      publicIpv4: publicIpv4.length,
      unavailable: [...unavailable],
      failures: run.failures,
    };
  }

  async analyze(account: AwsAccount): Promise<Omit<AnalysisDetails, 'ebs' | 'rds' | 'network'>> {
    const drafts: RecommendationDraft[] = [];
    const analyses = new Map<string, ResourceAnalysis>();
    const findings: Record<string, number> = {};
    let analyzed = 0;
    for (const type of Object.values(NETWORK_RESOURCE_TYPES)) {
      for (const resource of await this.inventory.findByType(account.id, type)) {
        const m = resource.metadata;
        if (!m.network) continue;
        const { analysis, draft } = this.analyzer.analyze({
          resourceId: resource.resourceId,
          resourceArn: resource.arn,
          resource: m.network,
          prices: m.networkPrices ?? null,
          currency: DEFAULT_CURRENCY,
        });
        await this.inventory.patchMetadata(account.id, resource.resourceType, resource.resourceId, { analysis });
        analyses.set(resource.resourceId, analysis);
        findings[analysis.finding] = (findings[analysis.finding] ?? 0) + 1;
        if (draft) drafts.push(draft);
        analyzed++;
      }
    }
    const sync = await this.recommendations.syncDrafts(account, NETWORK_RECOMMENDATION_TYPES, drafts, analyses);
    this.logger.log({ msg: 'Network analysis finished', awsAccountRef: account.id, analyzed, findings, drafts: drafts.length });
    return { analyzed, findings, ...sync };
  }

  private async enrichRegion(account: AwsAccount, region: string, seenAt: Date, unavailable: Set<string>) {
    const read = async <T>(operation: string, call: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await call();
      } catch (error) {
        const err = toAwsIntegrationError(error);
        if (err.code !== 'ACCESS_DENIED') throw err;
        if (!unavailable.has(operation)) this.logger.warn({ msg: 'Network data not readable: update the read-only role', awsAccountRef: account.id, operation });
        unavailable.add(operation);
        return fallback;
      }
    };
    const eips = await read('DescribeAddresses', () => this.network.listElasticIps(account, region), []);
    const nats = await read('DescribeNatGateways', () => this.network.listNatGateways(account, region), []);
    const lbs = await read('DescribeLoadBalancers', () => this.network.listLoadBalancers(account, region), []);
    const endpoints = await read('DescribeVpcEndpoints', () => this.network.gatewayEndpointsByVpc(account, region), new Map<string, string[]>());
    const enis = await read('DescribeNetworkInterfaces', () => this.network.publicNetworkInterfaces(account, region), []);
    const publicIpv4: PublicIpv4[] = publicIpv4Of(enis, eips.filter((e) => !e.associationId), region);
    const empty = { elasticIps: 0, natGateways: 0, loadBalancers: 0, publicIpv4, publicIpv4Hourly: null as number | null };
    if (eips.length === 0 && nats.length === 0 && lbs.length === 0 && publicIpv4.length === 0) return empty;

    const prices = await this.pricing.getNetworkPrices(region);
    const queries: MetricSumQuery[] = [
      ...nats.flatMap((n) =>
        ['BytesOutToDestination', 'BytesOutToSource'].map((metricName) => ({ ownerId: n.natGatewayId, namespace: 'AWS/NATGateway', metricName, dimensions: [{ Name: 'NatGatewayId', Value: n.natGatewayId }] })),
      ),
      ...lbs.flatMap((lb) => {
        const metric = LOAD_BALANCER_METRICS[lb.type];
        return metric ? [{ ownerId: lb.id, namespace: metric.namespace, metricName: metric.metricName, dimensions: [{ Name: 'LoadBalancer', Value: lb.metricDimension }] }] : [];
      }),
    ];
    const usage = await this.cloudWatch.getMetricSums(account, region, queries, METRICS_PERIOD_DAYS);
    const ipv4ByLb = new Map<string, number>();
    for (const ip of publicIpv4) if (ip.owner === 'LOAD_BALANCER' && ip.ownerId) ipv4ByLb.set(ip.ownerId, (ipv4ByLb.get(ip.ownerId) ?? 0) + 1);

    const entries: { data: AwsResourceData; network: NetworkResource }[] = [
      ...eips.map((eip) => ({
        data: { arn: `arn:aws:ec2:${region}:${account.awsAccountId}:elastic-ip/${eip.allocationId}`, resourceId: eip.allocationId, service: 'ec2', resourceType: NETWORK_RESOURCE_TYPES.EIP, region, name: eip.name ?? eip.publicIp, tags: eip.tags },
        network: { kind: 'EIP' as const, eip },
      })),
      ...nats.map((nat) => ({
        data: { arn: `arn:aws:ec2:${region}:${account.awsAccountId}:natgateway/${nat.natGatewayId}`, resourceId: nat.natGatewayId, service: 'ec2', resourceType: NETWORK_RESOURCE_TYPES.NAT, region, name: nat.name ?? undefined, tags: nat.tags },
        network: { kind: 'NAT' as const, nat, usage: usage.get(nat.natGatewayId) ?? null },
      })),
      ...lbs.map((lb) => ({
        data: { arn: lb.arn, resourceId: lb.id, service: 'elasticloadbalancing', resourceType: NETWORK_RESOURCE_TYPES.LB, region, name: lb.name, tags: {} },
        network: { kind: 'LB' as const, lb, usage: usage.get(lb.id) ?? null, publicIpv4: ipv4ByLb.get(lb.metricDimension) ?? 0 },
      })),
      ...this.vpcsWithNat(nats, endpoints, usage).map((vpc) => ({
        data: { arn: `arn:aws:ec2:${region}:${account.awsAccountId}:vpc/${vpc.vpcId}`, resourceId: vpc.vpcId, service: 'ec2', resourceType: NETWORK_RESOURCE_TYPES.VPC, region, tags: {} },
        network: { kind: 'VPC' as const, region, ...vpc },
      })),
    ];
    await this.inventory.upsertDiscovered(account, entries.map((e) => e.data), seenAt);
    for (const e of entries) {
      await this.inventory.patchMetadata(account.id, e.data.resourceType, e.data.resourceId, { network: e.network, networkPrices: prices, tags: e.data.tags });
    }
    this.logger.log({ msg: 'Network region enriched', awsAccountRef: account.id, region, elasticIps: eips.length, natGateways: nats.length, loadBalancers: lbs.length, publicIpv4: publicIpv4.length });
    return { elasticIps: eips.length, natGateways: nats.length, loadBalancers: lbs.length, publicIpv4, publicIpv4Hourly: prices.publicIpv4Hourly };
  }

  private vpcsWithNat(nats: { natGatewayId: string; vpcId: string | null }[], endpoints: Map<string, string[]>, usage: Map<string, { total: number | null }>) {
    const byVpc = new Map<string, string[]>();
    for (const n of nats) if (n.vpcId) byVpc.set(n.vpcId, [...(byVpc.get(n.vpcId) ?? []), n.natGatewayId]);
    return [...byVpc].map(([vpcId, natGatewayIds]) => {
      const totals = natGatewayIds.map((id) => usage.get(id)?.total ?? null);
      return {
        vpcId,
        natGatewayIds,
        natProcessedGb: totals.some((t) => t === null) ? null : totals.reduce<number>((s, t) => s + (t ?? 0), 0) / GIB_BYTES,
        gatewayEndpoints: endpoints.get(vpcId) ?? [],
      };
    });
  }
}
