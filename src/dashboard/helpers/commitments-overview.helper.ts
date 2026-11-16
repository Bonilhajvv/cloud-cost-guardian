import { HIGH_COMMITMENT_UTILIZATION } from '../../aws/commitments/constants/commitment.constant';
import { CommitmentSnapshot } from '../../aws/costs/interfaces/commitment.interface';
import { round } from '../../common/helpers/stats.helper';
import { CommitmentsOverview } from '../interfaces/commitments-overview.interface';

export function commitmentsOverview(accounts: { name: string; commitments: CommitmentSnapshot | null }[], currency = 'USD'): CommitmentsOverview {
  const withData = accounts.filter((a): a is { name: string; commitments: CommitmentSnapshot } => !!a.commitments);
  const coverages = withData.map((a) => a.commitments.savingsPlansCoverage).filter((c) => c !== null);
  const utilizations = withData.map((a) => a.commitments.savingsPlansUtilization).filter((u) => u !== null);
  const onDemand = coverages.length ? round(coverages.reduce((s, c) => s + c.onDemandCost, 0)) : null;
  const covered = coverages.length ? round(coverages.reduce((s, c) => s + c.coveredSpend, 0)) : null;
  const total = coverages.reduce((s, c) => s + c.totalCost, 0);
  const committed = utilizations.reduce((s, u) => s + u.totalCommitment, 0);
  const used = utilizations.reduce((s, u) => s + u.usedCommitment, 0);
  const alerts: string[] = [];
  let unused = 0;
  for (const { name, commitments } of withData) {
    const sp = commitments.savingsPlansUtilization;
    const ri = commitments.reservationUtilization;
    unused += (sp?.unusedCommitment ?? 0) + (ri?.unusedCost ?? 0);
    if (sp && (sp.utilizationPercentage ?? 100) < HIGH_COMMITMENT_UTILIZATION) {
      alerts.push(`${name}: Savings Plans used ${sp.utilizationPercentage}% in the last 30 days, ${currency} ${sp.unusedCommitment} of commitment unused`);
    }
    if (ri && (ri.utilizationPercentage ?? 100) < HIGH_COMMITMENT_UTILIZATION) {
      alerts.push(`${name}: Reserved Instances used ${ri.utilizationPercentage}% in the last 30 days, ${currency} ${ri.unusedCost} paid for unused hours`);
    }
  }
  const fetched = withData.map((a) => a.commitments.fetchedAt).sort();
  return {
    accountsWithData: withData.length,
    onDemandMonthly: onDemand,
    coveredMonthly: covered,
    coveragePercentage: covered !== null && total > 0 ? round((covered / total) * 100) : null,
    savingsPlansUtilization: committed > 0 ? round((used / committed) * 100) : null,
    unusedCommitmentMonthly: round(unused),
    alerts,
    oldestFetchedAt: fetched[0] ?? null,
  };
}
