import { RDSDBRecommendation } from '@aws-sdk/client-compute-optimizer';
import { normalizeRdsRecommendation } from './normalize-rds-recommendation.helper';

describe('normalizeRdsRecommendation', () => {
  it('keeps class, finding, idle, options and utilization of a DB instance', () => {
    const rec = normalizeRdsRecommendation({
      resourceArn: 'arn:aws:rds:us-east-1:111122223333:db:acme-rds-databases-prd',
      currentDBInstanceClass: 'db.t3.medium',
      instanceFinding: 'Overprovisioned',
      idle: 'False',
      lookbackPeriodInDays: 14,
      instanceRecommendationOptions: [{ dbInstanceClass: 'db.t3.small', rank: 1, performanceRisk: 1, savingsOpportunity: { estimatedMonthlySavings: { value: 26.3, currency: 'USD' } } }],
      utilizationMetrics: [{ name: 'Memory', statistic: 'Maximum', value: 51.4 }],
    } as RDSDBRecommendation);

    expect(rec).toEqual({
      resourceArn: 'arn:aws:rds:us-east-1:111122223333:db:acme-rds-databases-prd',
      dbInstanceId: 'acme-rds-databases-prd',
      currentInstanceClass: 'db.t3.medium',
      finding: 'OVER_PROVISIONED',
      idle: false,
      lookBackPeriodDays: 14,
      options: [{ instanceClass: 'db.t3.small', rank: 1, performanceRisk: 1, estimatedMonthlySavings: 26.3 }],
      utilization: { 'Memory Maximum': 51.4 },
    });
  });

  it('ignores Aurora clusters', () => {
    expect(normalizeRdsRecommendation({ resourceArn: 'arn:aws:rds:us-east-1:1:cluster:c1', currentDBInstanceClass: 'db.r6g.large' } as RDSDBRecommendation)).toBeNull();
  });
});
