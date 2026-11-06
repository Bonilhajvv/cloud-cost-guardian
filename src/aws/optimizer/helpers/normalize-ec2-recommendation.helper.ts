import { InstanceRecommendation } from '@aws-sdk/client-compute-optimizer';
import { parseArn } from '../../core/helpers/arn.helper';
import { Ec2OptimizerFinding, Ec2OptimizerRecommendation } from '../interfaces/ec2-optimizer.interface';

export const FINDINGS: Record<string, Ec2OptimizerFinding> = {
  Overprovisioned: 'OVER_PROVISIONED',
  Underprovisioned: 'UNDER_PROVISIONED',
  Optimized: 'OPTIMIZED',
  NotOptimized: 'NOT_OPTIMIZED',
};

export function normalizeEc2Recommendation(r: InstanceRecommendation): Ec2OptimizerRecommendation | null {
  if (!r.instanceArn || !r.currentInstanceType) return null;
  const instanceId = parseArn(r.instanceArn)?.resourceId;
  if (!instanceId) return null;
  return {
    instanceArn: r.instanceArn,
    instanceId,
    currentInstanceType: r.currentInstanceType,
    finding: (r.finding && FINDINGS[r.finding]) || 'UNKNOWN',
    lookBackPeriodDays: r.lookBackPeriodInDays ?? null,
    lastRefreshedAt: r.lastRefreshTimestamp?.toISOString() ?? null,
    options: (r.recommendationOptions ?? [])
      .filter((o) => !!o.instanceType)
      .map((o) => ({
        instanceType: o.instanceType as string,
        rank: o.rank ?? null,
        performanceRisk: o.performanceRisk ?? null,
        estimatedMonthlySavings: o.savingsOpportunity?.estimatedMonthlySavings?.value ?? null,
        savingsPercentage: o.savingsOpportunity?.savingsOpportunityPercentage ?? null,
        currency: o.savingsOpportunity?.estimatedMonthlySavings?.currency ?? 'USD',
        spec: null,
      })),
  };
}
