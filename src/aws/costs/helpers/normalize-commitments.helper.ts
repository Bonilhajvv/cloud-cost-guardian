import {
  GetReservationPurchaseRecommendationResponse,
  GetReservationUtilizationResponse,
  GetSavingsPlansCoverageResponse,
  GetSavingsPlansPurchaseRecommendationResponse,
  GetSavingsPlansUtilizationResponse,
} from '@aws-sdk/client-cost-explorer';
import { round } from '../../../common/helpers/stats.helper';
import {
  CommitmentTerm,
  ReservationRecommendation,
  ReservationUtilization,
  SavingsPlanRecommendation,
  SavingsPlansCoverage,
  SavingsPlansUtilization,
} from '../interfaces/commitment.interface';

function num(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? round(n) : null;
}

export function normalizeSavingsPlanRecommendation(
  out: GetSavingsPlansPurchaseRecommendationResponse,
  term: CommitmentTerm,
  paymentOption: string,
): SavingsPlanRecommendation | null {
  const summary = out.SavingsPlansPurchaseRecommendation?.SavingsPlansPurchaseRecommendationSummary;
  const details = out.SavingsPlansPurchaseRecommendation?.SavingsPlansPurchaseRecommendationDetails ?? [];
  const hourly = Number(summary?.HourlyCommitmentToPurchase);
  const savings = num(summary?.EstimatedMonthlySavingsAmount);
  if (!summary || !Number.isFinite(hourly) || hourly <= 0 || savings === null || savings <= 0) return null;
  const utilization = details.length === 1 ? num(details[0].EstimatedAverageUtilization) : null;
  return {
    term,
    paymentOption,
    hourlyCommitment: hourly,
    monthlySavings: savings,
    savingsPercentage: num(summary.EstimatedSavingsPercentage),
    currentOnDemandMonthly: num(summary.CurrentOnDemandSpend),
    estimatedUtilization: utilization,
    generatedAt: out.Metadata?.GenerationTimestamp ?? null,
  };
}

export function normalizeReservationRecommendation(
  out: GetReservationPurchaseRecommendationResponse,
  term: CommitmentTerm,
  paymentOption: string,
): ReservationRecommendation | null {
  const items = (out.Recommendations ?? []).flatMap((r) =>
    (r.RecommendationDetails ?? []).flatMap((d) => {
      const rds = d.InstanceDetails?.RDSInstanceDetails;
      const savings = num(d.EstimatedMonthlySavingsAmount);
      const count = Number(d.RecommendedNumberOfInstancesToPurchase);
      if (!rds?.InstanceType || savings === null || savings <= 0 || !Number.isFinite(count) || count <= 0) return [];
      return [
        {
          instanceType: rds.InstanceType,
          engine: rds.DatabaseEngine ?? null,
          deploymentOption: rds.DeploymentOption ?? null,
          region: rds.Region ?? null,
          count,
          monthlySavings: savings,
          onDemandMonthly: num(d.EstimatedMonthlyOnDemandCost),
          recurringMonthly: num(d.RecurringStandardMonthlyCost),
          upfront: num(d.UpfrontCost),
          utilization: num(d.AverageUtilization),
          sizeFlexible: rds.SizeFlexEligible ?? false,
        },
      ];
    }),
  );
  if (items.length === 0) return null;
  const summary = out.Recommendations?.[0]?.RecommendationSummary;
  return {
    term,
    paymentOption,
    monthlySavings: round(items.reduce((s, i) => s + i.monthlySavings, 0)),
    savingsPercentage: num(summary?.TotalEstimatedMonthlySavingsPercentage),
    items,
    generatedAt: out.Metadata?.GenerationTimestamp ?? null,
  };
}

export function normalizeSavingsPlansCoverage(out: GetSavingsPlansCoverageResponse): SavingsPlansCoverage | null {
  const rows = out.SavingsPlansCoverages ?? [];
  if (rows.length === 0) return null;
  const sum = (pick: (c: NonNullable<(typeof rows)[number]['Coverage']>) => string | undefined) =>
    round(rows.reduce((s, r) => s + (r.Coverage ? Number(pick(r.Coverage) ?? 0) || 0 : 0), 0));
  const covered = sum((c) => c.SpendCoveredBySavingsPlans);
  const total = sum((c) => c.TotalCost);
  return {
    periodStart: rows[0].TimePeriod?.Start ?? '',
    periodEnd: rows[rows.length - 1].TimePeriod?.End ?? '',
    coveredSpend: covered,
    onDemandCost: sum((c) => c.OnDemandCost),
    totalCost: total,
    coveragePercentage: total > 0 ? round((covered / total) * 100) : null,
  };
}

export function normalizeSavingsPlansUtilization(out: GetSavingsPlansUtilizationResponse): SavingsPlansUtilization | null {
  const u = out.Total?.Utilization;
  const total = num(u?.TotalCommitment);
  if (!u || total === null || total <= 0) return null;
  return {
    totalCommitment: total,
    usedCommitment: num(u.UsedCommitment) ?? 0,
    unusedCommitment: num(u.UnusedCommitment) ?? 0,
    utilizationPercentage: num(u.UtilizationPercentage),
  };
}

export function normalizeReservationUtilization(out: GetReservationUtilizationResponse): ReservationUtilization | null {
  const t = out.Total;
  const purchased = num(t?.PurchasedHours);
  if (!t || purchased === null || purchased <= 0) return null;
  return {
    purchasedHours: purchased,
    utilizationPercentage: num(t.UtilizationPercentage),
    unusedCost: num(t.RICostForUnusedHours) ?? 0,
    netSavings: num(t.NetRISavings) ?? 0,
  };
}
