import { CommitmentSnapshot } from '../../aws/costs/interfaces/commitment.interface';
import { commitmentsOverview } from './commitments-overview.helper';

const snap = (overrides: Partial<CommitmentSnapshot>): CommitmentSnapshot => ({
  fetchedAt: '2026-11-16T00:00:00.000Z',
  savingsPlans: { oneYear: null, threeYears: null },
  rdsReservations: null,
  savingsPlansCoverage: null,
  savingsPlansUtilization: null,
  reservationUtilization: null,
  unavailable: [],
  ...overrides,
});

describe('commitmentsOverview', () => {
  it('adds coverage across accounts and flags commitments that are paid but not used', () => {
    const overview = commitmentsOverview([
      { name: 'prod', commitments: snap({ savingsPlansCoverage: { periodStart: '', periodEnd: '', coveredSpend: 300, onDemandCost: 100, totalCost: 400, coveragePercentage: 75 }, savingsPlansUtilization: { totalCommitment: 300, usedCommitment: 210, unusedCommitment: 90, utilizationPercentage: 70 } }) },
      { name: 'acme', commitments: snap({ fetchedAt: '2026-11-15T00:00:00.000Z', savingsPlansCoverage: { periodStart: '', periodEnd: '', coveredSpend: 0, onDemandCost: 200, totalCost: 200, coveragePercentage: 0 }, reservationUtilization: { purchasedHours: 720, utilizationPercentage: 95, unusedCost: 2, netSavings: 10 } }) },
      { name: 'new', commitments: null },
    ]);

    expect(overview).toEqual({
      accountsWithData: 2,
      onDemandMonthly: 300,
      coveredMonthly: 300,
      coveragePercentage: 50,
      savingsPlansUtilization: 70,
      unusedCommitmentMonthly: 92,
      alerts: ['prod: Savings Plans used 70% in the last 30 days, USD 90 of commitment unused'],
      oldestFetchedAt: '2026-11-15T00:00:00.000Z',
    });
  });

  it('returns nulls instead of zeros without data', () => {
    expect(commitmentsOverview([{ name: 'new', commitments: null }])).toMatchObject({ accountsWithData: 0, onDemandMonthly: null, coveragePercentage: null, savingsPlansUtilization: null });
  });
});
