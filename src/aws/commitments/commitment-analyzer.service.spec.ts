import { Level, RecommendationSource, RecommendationType } from '../../common/enums';
import { CommitmentSnapshot } from '../costs/interfaces/commitment.interface';
import { CommitmentAnalyzerService } from './commitment-analyzer.service';

const NOW = new Date('2026-11-16T12:00:00Z');

function snapshot(overrides: Partial<CommitmentSnapshot> = {}): CommitmentSnapshot {
  return {
    fetchedAt: NOW.toISOString(),
    savingsPlans: {
      oneYear: { term: 'ONE_YEAR', paymentOption: 'NO_UPFRONT', hourlyCommitment: 0.224, monthlySavings: 46.15, savingsPercentage: 21.57, currentOnDemandMonthly: 211.01, estimatedUtilization: 92.47, generatedAt: null },
      threeYears: { term: 'THREE_YEARS', paymentOption: 'NO_UPFRONT', hourlyCommitment: 0.18, monthlySavings: 78.4, savingsPercentage: 37.2, currentOnDemandMonthly: 211.01, estimatedUtilization: 95, generatedAt: null },
    },
    rdsReservations: {
      term: 'ONE_YEAR',
      paymentOption: 'NO_UPFRONT',
      monthlySavings: 16.51,
      savingsPercentage: 26,
      generatedAt: null,
      items: [
        { instanceType: 'db.t3.micro', engine: 'PostgreSQL', deploymentOption: 'Single-AZ', region: 'US East (N. Virginia)', count: 5, monthlySavings: 16.51, onDemandMonthly: 63.59, recurringMonthly: 47.09, upfront: 0, utilization: 96.79, sizeFlexible: true },
      ],
    },
    savingsPlansCoverage: { periodStart: '2026-10-17', periodEnd: '2026-11-15', coveredSpend: 0, onDemandCost: 204.72, totalCost: 204.72, coveragePercentage: 0 },
    savingsPlansUtilization: null,
    reservationUtilization: null,
    unavailable: [],
    ...overrides,
  };
}

describe('CommitmentAnalyzerService', () => {
  const analyzer = new CommitmentAnalyzerService();

  it('turns the Savings Plan and RDS reservation recommendations into drafts', () => {
    const { drafts, analyses } = analyzer.analyze({ awsAccountId: '105337279635', snapshot: snapshot(), currency: 'USD', now: NOW });

    expect(analyses.map((a) => a.resourceId)).toEqual(['105337279635/compute-savings-plan', '105337279635/rds-reserved-instances']);
    expect(drafts[0]).toMatchObject({
      type: RecommendationType.SAVINGS_PLAN_PURCHASE,
      source: RecommendationSource.COST_EXPLORER,
      service: 'savingsplans',
      title: 'Buy a Compute Savings Plan: USD 0.224/hour for 1 year, no upfront',
      currentMonthlyCost: 211.01,
      recommendedMonthlyCost: 164.86,
      estimatedMonthlySavings: 46.15,
      estimatedYearlySavings: 553.8,
      risk: Level.MEDIUM,
      confidence: Level.HIGH,
      targetKey: 'COMPUTE_SP_1Y_NO_UPFRONT',
    });
    expect(drafts[0].description).toContain('USD 163.52/month');
    expect(drafts[0].description).toContain('3-year alternative: USD 0.18/hour saves USD 78.4/month');
    expect(drafts[0].description).toContain('Apply open rightsizing and idle recommendations first');
    expect(drafts[1]).toMatchObject({
      type: RecommendationType.RESERVED_INSTANCE_PURCHASE,
      service: 'rds',
      title: 'Buy RDS Reserved Instances: 5 x db.t3.micro for 1 year, no upfront',
      estimatedMonthlySavings: 16.51,
      recommendedMonthlyCost: 47.08,
      confidence: Level.HIGH,
    });
    expect(drafts[1].description).toContain('5 x db.t3.micro PostgreSQL Single-AZ in US East (N. Virginia): saves USD 16.51/month, expected use 96.79%');
    expect(drafts[1].description).toContain('Size flexible');
  });

  it('keeps analyses without drafts when savings are too small or missing, so open ones get resolved', () => {
    const { drafts, analyses } = analyzer.analyze({
      awsAccountId: '1',
      snapshot: snapshot({ savingsPlans: { oneYear: null, threeYears: null }, rdsReservations: { ...snapshot().rdsReservations!, monthlySavings: 2 } }),
      currency: 'USD',
      now: NOW,
    });

    expect(drafts).toEqual([]);
    expect(analyses.map((a) => a.finding)).toEqual(['NO_RECOMMENDATION', 'NO_RECOMMENDATION']);
  });

  it('lowers confidence when the expected use of the commitment is below 90%', () => {
    const base = snapshot();
    const { drafts } = analyzer.analyze({
      awsAccountId: '1',
      snapshot: { ...base, savingsPlans: { oneYear: { ...base.savingsPlans.oneYear!, estimatedUtilization: 80 }, threeYears: null } },
      currency: 'USD',
      now: NOW,
    });

    expect(drafts[0].confidence).toBe(Level.MEDIUM);
    expect(drafts[0].description).not.toContain('3-year');
  });
});
