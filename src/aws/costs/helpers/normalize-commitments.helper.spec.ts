import {
  normalizeReservationRecommendation,
  normalizeReservationUtilization,
  normalizeSavingsPlanRecommendation,
  normalizeSavingsPlansCoverage,
  normalizeSavingsPlansUtilization,
} from './normalize-commitments.helper';

describe('commitment normalizers (shapes from a real Cost Explorer response)', () => {
  it('reads the Compute Savings Plan recommendation', () => {
    const rec = normalizeSavingsPlanRecommendation(
      {
        Metadata: { GenerationTimestamp: '2026-11-15T09:37:14Z' },
        SavingsPlansPurchaseRecommendation: {
          SavingsPlansPurchaseRecommendationSummary: {
            CurrentOnDemandSpend: '211.0063070744',
            HourlyCommitmentToPurchase: '0.224',
            EstimatedSavingsPercentage: '21.5719822500',
            EstimatedMonthlySavingsAmount: '46.1504409330',
          },
          SavingsPlansPurchaseRecommendationDetails: [{ EstimatedAverageUtilization: '92.4685167600' }],
        },
      },
      'ONE_YEAR',
      'NO_UPFRONT',
    );

    expect(rec).toEqual({
      term: 'ONE_YEAR',
      paymentOption: 'NO_UPFRONT',
      hourlyCommitment: 0.224,
      monthlySavings: 46.15,
      savingsPercentage: 21.57,
      currentOnDemandMonthly: 211.01,
      estimatedUtilization: 92.47,
      generatedAt: '2026-11-15T09:37:14Z',
    });
  });

  it('returns null when AWS has nothing to recommend', () => {
    expect(normalizeSavingsPlanRecommendation({ SavingsPlansPurchaseRecommendation: {} }, 'ONE_YEAR', 'NO_UPFRONT')).toBeNull();
    expect(
      normalizeSavingsPlanRecommendation(
        { SavingsPlansPurchaseRecommendation: { SavingsPlansPurchaseRecommendationSummary: { HourlyCommitmentToPurchase: '0', EstimatedMonthlySavingsAmount: '0' } } },
        'ONE_YEAR',
        'NO_UPFRONT',
      ),
    ).toBeNull();
  });

  it('reads RDS reservation details', () => {
    const rec = normalizeReservationRecommendation(
      {
        Metadata: { GenerationTimestamp: '2026-11-16T09:05:01Z' },
        Recommendations: [
          {
            RecommendationSummary: { TotalEstimatedMonthlySavingsPercentage: '26.0000' },
            RecommendationDetails: [
              {
                InstanceDetails: {
                  RDSInstanceDetails: { InstanceType: 'db.t3.micro', Region: 'US East (N. Virginia)', DatabaseEngine: 'PostgreSQL', DeploymentOption: 'Single-AZ', SizeFlexEligible: true },
                },
                RecommendedNumberOfInstancesToPurchase: '5',
                EstimatedMonthlySavingsAmount: '16.5059536238',
                EstimatedMonthlyOnDemandCost: '63.5909536238',
                RecurringStandardMonthlyCost: '47.0850000000',
                UpfrontCost: '0.0000000000',
                AverageUtilization: '96.7898837500',
              },
            ],
          },
        ],
      },
      'ONE_YEAR',
      'NO_UPFRONT',
    );

    expect(rec).toMatchObject({ monthlySavings: 16.51, savingsPercentage: 26 });
    expect(rec?.items).toEqual([
      {
        instanceType: 'db.t3.micro',
        engine: 'PostgreSQL',
        deploymentOption: 'Single-AZ',
        region: 'US East (N. Virginia)',
        count: 5,
        monthlySavings: 16.51,
        onDemandMonthly: 63.59,
        recurringMonthly: 47.09,
        upfront: 0,
        utilization: 96.79,
        sizeFlexible: true,
      },
    ]);
    expect(normalizeReservationRecommendation({ Recommendations: [] }, 'ONE_YEAR', 'NO_UPFRONT')).toBeNull();
  });

  it('reads coverage and treats accounts without commitments as no data', () => {
    expect(
      normalizeSavingsPlansCoverage({
        SavingsPlansCoverages: [
          { Coverage: { SpendCoveredBySavingsPlans: '0', OnDemandCost: '204.72', TotalCost: '204.72' }, TimePeriod: { Start: '2026-10-17', End: '2026-11-15' } },
        ],
      }),
    ).toEqual({ periodStart: '2026-10-17', periodEnd: '2026-11-15', coveredSpend: 0, onDemandCost: 204.72, totalCost: 204.72, coveragePercentage: 0 });
    expect(normalizeReservationUtilization({ UtilizationsByTime: [], Total: { PurchasedHours: '0', UtilizationPercentage: '0' } })).toBeNull();
    expect(normalizeSavingsPlansUtilization({ Total: { Utilization: { TotalCommitment: '100', UsedCommitment: '70', UnusedCommitment: '30', UtilizationPercentage: '70' } } })).toEqual({
      totalCommitment: 100,
      usedCommitment: 70,
      unusedCommitment: 30,
      utilizationPercentage: 70,
    });
  });
});
