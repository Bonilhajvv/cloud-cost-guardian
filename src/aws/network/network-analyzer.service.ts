import { Injectable } from '@nestjs/common';
import { Level, RecommendationSource, RecommendationType } from '../../common/enums';
import { round } from '../../common/helpers/stats.helper';
import { severityFor } from '../ec2/helpers/risk-level.helper';
import { HOURS_PER_MONTH } from '../pricing/constants/pricing.constant';
import { DAY_MS } from '../rds/constants/rds.constant';
import { GIB_BYTES, IDLE_NAT_MAX_GB, NETWORK_MIN_AGE_DAYS } from './constants/network.constant';
import { NetworkAnalysis, NetworkAnalyzerInput, NetworkAnalyzerResult } from './interfaces/network-analysis.interface';

interface Finding {
  type: RecommendationType;
  finding: NetworkAnalysis['finding'];
  title: string;
  reasons: string[];
  savings: number | null;
  risk: Level;
  confidence: Level;
  targetKey: string;
}

@Injectable()
export class NetworkAnalyzerService {
  analyze(input: NetworkAnalyzerInput): NetworkAnalyzerResult {
    const now = input.now ?? new Date();
    const { resource } = input;
    const monthly = this.monthlyCost(input);
    const analysis: NetworkAnalysis = {
      kind: 'NETWORK',
      resourceId: input.resourceId,
      resourceArn: input.resourceArn,
      name: this.nameOf(input),
      region: resource.kind === 'EIP' ? resource.eip.region : resource.kind === 'NAT' ? resource.nat.region : resource.kind === 'LB' ? resource.lb.region : resource.region,
      finding: 'OPTIMIZED',
      current: { resource: resource.kind, monthlyCost: monthly === null ? null : round(monthly) },
      recommendation: null,
      savings: null,
      analyzedAt: now.toISOString(),
    };
    const found = this.find(input, monthly, now);
    if (!found) return { analysis, draft: null };
    if (found.finding === 'INSUFFICIENT_DATA') {
      analysis.finding = 'INSUFFICIENT_DATA';
      return { analysis, draft: null };
    }
    analysis.finding = found.finding;
    analysis.recommendation = { type: found.type, source: RecommendationSource.CCG_HEURISTIC, performanceRisk: found.risk, confidence: found.confidence, reasons: found.reasons };
    const saving = found.savings === null ? null : round(found.savings);
    if (saving !== null) analysis.savings = { monthly: saving, yearly: round(saving * 12), currency: input.currency };
    const savingsText = saving === null ? 'savings unknown' : `${input.currency} ${saving}/month`;
    return {
      analysis,
      draft: {
        resourceId: input.resourceId,
        resourceArn: input.resourceArn,
        service: resource.kind === 'LB' ? 'elasticloadbalancing' : 'ec2',
        type: found.type,
        source: RecommendationSource.CCG_HEURISTIC,
        title: found.title,
        description: `${found.reasons.join('. ')}. Estimated savings: ${savingsText}.`,
        severity: severityFor(saving),
        risk: found.risk,
        confidence: found.confidence,
        currentMonthlyCost: analysis.current.monthlyCost,
        recommendedMonthlyCost: analysis.current.monthlyCost !== null && saving !== null ? round(Math.max(0, analysis.current.monthlyCost - saving)) : null,
        estimatedMonthlySavings: saving,
        estimatedYearlySavings: saving === null ? null : round(saving * 12),
        currency: input.currency,
        targetKey: found.targetKey,
        analysis,
      },
    };
  }

  private find(input: NetworkAnalyzerInput, monthly: number | null, now: Date): Finding | null {
    const { resource, currency } = input;
    const ipv4 = this.ipv4Monthly(input);
    switch (resource.kind) {
      case 'EIP': {
        if (resource.eip.associationId) return null;
        return {
          type: RecommendationType.EIP_UNUSED,
          finding: 'IDLE',
          title: `Release unused Elastic IP ${resource.eip.publicIp}${resource.eip.name ? ` (${resource.eip.name})` : ''}`,
          reasons: [
            'Elastic IP not associated with any instance or network interface',
            `AWS charges every public IPv4 address${ipv4 === null ? '' : ` (${currency} ${round(ipv4)}/month)`}, even when it is idle`,
            'Releasing gives the address back to AWS: confirm no DNS record or allow-list depends on it',
          ],
          savings: ipv4,
          risk: Level.LOW,
          confidence: Level.HIGH,
          targetKey: 'RELEASE',
        };
      }
      case 'NAT': {
        if (this.young(resource.nat.createTime, now)) return null;
        if (!resource.usage || resource.usage.datapoints === 0 || resource.usage.total === null) return { ...this.none(), finding: 'INSUFFICIENT_DATA' };
        const gb = resource.usage.total / GIB_BYTES;
        if (gb >= IDLE_NAT_MAX_GB) return null;
        return {
          type: RecommendationType.NAT_GATEWAY_IDLE,
          finding: 'IDLE',
          title: `Delete idle NAT Gateway ${resource.nat.name ?? resource.nat.natGatewayId}`,
          reasons: [
            `Only ${round(gb)} GB through the NAT Gateway in ${resource.usage.periodDays} days`,
            'A NAT Gateway is billed per hour even without traffic, plus its public IPv4 address',
            'Check the private subnet route tables first: instances there lose internet access without it',
          ],
          savings: monthly,
          risk: Level.MEDIUM,
          confidence: Level.HIGH,
          targetKey: 'DELETE',
        };
      }
      case 'LB': {
        if (this.young(resource.lb.createdAt, now)) return null;
        if (!resource.usage || resource.usage.datapoints === 0) return { ...this.none(), finding: 'INSUFFICIENT_DATA' };
        if ((resource.usage.total ?? 0) > 0) return null;
        const unit = resource.lb.type === 'network' ? 'new connections' : 'requests';
        return {
          type: RecommendationType.LOAD_BALANCER_IDLE,
          finding: 'IDLE',
          title: `Delete idle ${resource.lb.type} load balancer ${resource.lb.name}`,
          reasons: [
            `No ${unit} in ${resource.usage.periodDays} days`,
            `A load balancer is billed per hour even without traffic${resource.publicIpv4 ? `, plus ${resource.publicIpv4} public IPv4 address(es)` : ''}`,
            'Check DNS records and listeners that still point to it before deleting',
          ],
          savings: monthly,
          risk: Level.MEDIUM,
          confidence: Level.HIGH,
          targetKey: 'DELETE',
        };
      }
      case 'VPC': {
        const missing = ['s3', 'dynamodb'].filter((s) => !resource.gatewayEndpoints.includes(s));
        if (resource.natGatewayIds.length === 0 || !missing.includes('s3')) return null;
        const perGb = input.prices?.natGatewayPerGb ?? null;
        const processed = resource.natProcessedGb;
        return {
          type: RecommendationType.VPC_ENDPOINT_MISSING,
          finding: 'MISSING_ENDPOINT',
          title: `Add free S3${missing.includes('dynamodb') ? ' and DynamoDB' : ''} gateway endpoint to VPC ${resource.vpcId}`,
          reasons: [
            `Traffic to ${missing.map((s) => (s === 's3' ? 'S3' : 'DynamoDB')).join(' and ')} goes through the NAT Gateway${perGb === null ? '' : `, billed at ${currency} ${perGb}/GB`}`,
            ...(processed === null ? [] : [`The NAT Gateways of this VPC processed ${round(processed)} GB in 14 days${perGb === null ? '' : ` (${currency} ${round(processed * perGb)})`}; the S3 share is not visible in CloudWatch`]),
            'Gateway endpoints for S3 and DynamoDB have no hourly or data charge: add them to the private route tables',
            'Container image pulls from ECR also store layers in S3, so Kubernetes and ECS nodes benefit directly',
          ],
          savings: null,
          risk: Level.LOW,
          confidence: Level.MEDIUM,
          targetKey: 'GATEWAY_ENDPOINT',
        };
      }
    }
  }

  private none(): Finding {
    return { type: RecommendationType.NAT_GATEWAY_IDLE, finding: 'OPTIMIZED', title: '', reasons: [], savings: null, risk: Level.LOW, confidence: Level.LOW, targetKey: '' };
  }

  private young(createdAt: string | null, now: Date): boolean {
    return createdAt !== null && now.getTime() - Date.parse(createdAt) < NETWORK_MIN_AGE_DAYS * DAY_MS;
  }

  private ipv4Monthly(input: NetworkAnalyzerInput): number | null {
    const hourly = input.prices?.publicIpv4Hourly;
    return hourly === null || hourly === undefined ? null : hourly * HOURS_PER_MONTH;
  }

  private monthlyCost(input: NetworkAnalyzerInput): number | null {
    const { resource, prices } = input;
    const ipv4 = this.ipv4Monthly(input);
    if (resource.kind === 'EIP') return ipv4;
    if (resource.kind === 'NAT') {
      const hourly = prices?.natGatewayHourly;
      if (hourly === null || hourly === undefined) return null;
      return hourly * HOURS_PER_MONTH + (resource.nat.connectivity === 'public' ? ipv4 ?? 0 : 0);
    }
    if (resource.kind === 'LB') {
      const hourly = prices?.loadBalancerHourly[resource.lb.type];
      if (hourly === undefined) return null;
      return hourly * HOURS_PER_MONTH + resource.publicIpv4 * (ipv4 ?? 0);
    }
    return null;
  }

  private nameOf(input: NetworkAnalyzerInput): string | null {
    const { resource } = input;
    if (resource.kind === 'EIP') return resource.eip.name ?? resource.eip.publicIp;
    if (resource.kind === 'NAT') return resource.nat.name ?? resource.nat.natGatewayId;
    if (resource.kind === 'LB') return resource.lb.name;
    return resource.vpcId;
  }
}
