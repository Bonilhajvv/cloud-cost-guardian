import { CommitmentAnalyzerService } from '../aws/commitments/commitment-analyzer.service';
import { CostExplorerService } from '../aws/costs/cost-explorer.service';
import { AwsAccountsService } from '../aws-accounts/aws-accounts.service';
import { AwsAccount } from '../aws-accounts/entities/aws-account.entity';
import { RecommendationType } from '../common/enums';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { CommitmentSyncService } from './commitment-sync.service';

const NOW = new Date('2026-11-16T12:00:00Z');
const denied = () => Object.assign(new Error('not authorized'), { name: 'AccessDeniedException' });

function build() {
  const deps = {
    costExplorer: {
      getSavingsPlanRecommendation: jest.fn(async (_a: unknown, term: string) => ({
        term,
        paymentOption: 'NO_UPFRONT',
        hourlyCommitment: term === 'ONE_YEAR' ? 0.224 : 0.18,
        monthlySavings: term === 'ONE_YEAR' ? 46.15 : 78.4,
        savingsPercentage: 21.57,
        currentOnDemandMonthly: 211.01,
        estimatedUtilization: 92.47,
        generatedAt: null,
      })),
      getRdsReservationRecommendation: jest.fn().mockResolvedValue(null),
      getSavingsPlansCoverage: jest.fn().mockResolvedValue(null),
      getSavingsPlansUtilization: jest.fn().mockResolvedValue(null),
      getReservationUtilization: jest.fn().mockResolvedValue(null),
    },
    accounts: { saveCommitments: jest.fn() },
    recommendations: { syncDrafts: jest.fn().mockResolvedValue({ created: 1, updated: 0, resolved: 0, skipped: 0 }) },
  };
  const service = new CommitmentSyncService(
    deps.costExplorer as unknown as CostExplorerService,
    deps.accounts as unknown as AwsAccountsService,
    new CommitmentAnalyzerService(),
    deps.recommendations as unknown as RecommendationsService,
  );
  const account = { id: 'acc-1', organizationId: 'org-1', awsAccountId: '105337279635', commitments: null } as AwsAccount;
  return { service, deps, account };
}

describe('CommitmentSyncService', () => {
  it('fetches once, stores the snapshot and syncs both commitment types', async () => {
    const { service, deps, account } = build();

    const details = await service.sync(account, NOW);

    expect(details).toMatchObject({ fetched: true, unavailable: [], potentialMonthlySavings: 46.15, created: 1 });
    expect(deps.accounts.saveCommitments).toHaveBeenCalledWith('acc-1', expect.objectContaining({ fetchedAt: NOW.toISOString() }));
    const [, types, drafts, analyses] = deps.recommendations.syncDrafts.mock.calls[0];
    expect(types).toEqual([RecommendationType.SAVINGS_PLAN_PURCHASE, RecommendationType.RESERVED_INSTANCE_PURCHASE]);
    expect(drafts.map((d: { type: RecommendationType }) => d.type)).toEqual([RecommendationType.SAVINGS_PLAN_PURCHASE]);
    expect([...analyses.keys()]).toEqual(['105337279635/compute-savings-plan', '105337279635/rds-reserved-instances']);
  });

  it('reuses the stored snapshot for 24 hours to avoid paid Cost Explorer calls', async () => {
    const { service, deps, account } = build();
    await service.sync(account, NOW);
    const calls = Object.values(deps.costExplorer).reduce((s, fn) => s + fn.mock.calls.length, 0);

    const later = await service.sync(account, new Date(NOW.getTime() + 23 * 60 * 60 * 1000));
    const again = Object.values(deps.costExplorer).reduce((s, fn) => s + fn.mock.calls.length, 0);
    expect(later.fetched).toBe(false);
    expect(again).toBe(calls);
    expect(deps.recommendations.syncDrafts).toHaveBeenCalledTimes(2);

    await service.sync(account, new Date(NOW.getTime() + 25 * 60 * 60 * 1000));
    expect(Object.values(deps.costExplorer).reduce((s, fn) => s + fn.mock.calls.length, 0)).toBeGreaterThan(again);
  });

  it('skips the 3-year call when there is no 1-year recommendation', async () => {
    const { service, deps, account } = build();
    deps.costExplorer.getSavingsPlanRecommendation.mockResolvedValue(null as never);

    await service.sync(account, NOW);
    expect(deps.costExplorer.getSavingsPlanRecommendation).toHaveBeenCalledTimes(1);
  });

  it('does not resolve recommendations of a type the role cannot read', async () => {
    const { service, deps, account } = build();
    deps.costExplorer.getRdsReservationRecommendation.mockRejectedValue(denied());

    const details = await service.sync(account, NOW);
    expect(details.unavailable).toEqual(['rdsReservationRecommendation']);
    expect(deps.recommendations.syncDrafts.mock.calls[0][1]).toEqual([RecommendationType.SAVINGS_PLAN_PURCHASE]);
  });

  it('never fails the cost step on other errors', async () => {
    const { service, deps, account } = build();
    deps.costExplorer.getSavingsPlanRecommendation.mockRejectedValue(Object.assign(new Error('slow down'), { name: 'ThrottlingException' }));

    const details = await service.sync(account, NOW);
    expect(details).toMatchObject({ fetched: false, error: expect.stringContaining('THROTTLED') });
    expect(deps.recommendations.syncDrafts).not.toHaveBeenCalled();
    expect(deps.accounts.saveCommitments).not.toHaveBeenCalled();
  });
});
