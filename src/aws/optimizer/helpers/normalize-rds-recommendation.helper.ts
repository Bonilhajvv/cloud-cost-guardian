import { RDSDBRecommendation } from '@aws-sdk/client-compute-optimizer';
import { parseArn } from '../../core/helpers/arn.helper';
import { RdsOptimizerRecommendation } from '../interfaces/rds-optimizer.interface';
import { FINDINGS } from './normalize-ec2-recommendation.helper';

export function normalizeRdsRecommendation(r: RDSDBRecommendation): RdsOptimizerRecommendation | null {
  const arn = r.resourceArn ? parseArn(r.resourceArn) : null;
  if (!r.resourceArn || !r.currentDBInstanceClass || !arn?.resource.startsWith('db:')) return null;
  return {
    resourceArn: r.resourceArn,
    dbInstanceId: arn.resourceId,
    currentInstanceClass: r.currentDBInstanceClass,
    finding: (r.instanceFinding && FINDINGS[r.instanceFinding]) || 'UNKNOWN',
    idle: r.idle === undefined ? null : r.idle === 'True',
    lookBackPeriodDays: r.lookbackPeriodInDays ?? null,
    options: (r.instanceRecommendationOptions ?? [])
      .filter((o) => !!o.dbInstanceClass)
      .map((o) => ({
        instanceClass: o.dbInstanceClass as string,
        rank: o.rank ?? null,
        performanceRisk: o.performanceRisk ?? null,
        estimatedMonthlySavings: o.savingsOpportunity?.estimatedMonthlySavings?.value ?? null,
      })),
    utilization: Object.fromEntries(
      (r.utilizationMetrics ?? []).filter((m) => m.name && m.statistic && m.value !== undefined).map((m) => [`${m.name} ${m.statistic}`, m.value as number]),
    ),
  };
}
