export type CommitmentTerm = 'ONE_YEAR' | 'THREE_YEARS';

export interface SavingsPlanRecommendation {
  term: CommitmentTerm;
  paymentOption: string;
  hourlyCommitment: number;
  monthlySavings: number;
  savingsPercentage: number | null;
  currentOnDemandMonthly: number | null;
  estimatedUtilization: number | null;
  generatedAt: string | null;
}

export interface ReservationRecommendationItem {
  instanceType: string;
  engine: string | null;
  deploymentOption: string | null;
  region: string | null;
  count: number;
  monthlySavings: number;
  onDemandMonthly: number | null;
  recurringMonthly: number | null;
  upfront: number | null;
  utilization: number | null;
  sizeFlexible: boolean;
}

export interface ReservationRecommendation {
  term: CommitmentTerm;
  paymentOption: string;
  monthlySavings: number;
  savingsPercentage: number | null;
  items: ReservationRecommendationItem[];
  generatedAt: string | null;
}

export interface SavingsPlansCoverage {
  periodStart: string;
  periodEnd: string;
  coveredSpend: number;
  onDemandCost: number;
  totalCost: number;
  coveragePercentage: number | null;
}

export interface SavingsPlansUtilization {
  totalCommitment: number;
  usedCommitment: number;
  unusedCommitment: number;
  utilizationPercentage: number | null;
}

export interface ReservationUtilization {
  purchasedHours: number;
  utilizationPercentage: number | null;
  unusedCost: number;
  netSavings: number;
}

export interface CommitmentSnapshot {
  fetchedAt: string;
  savingsPlans: { oneYear: SavingsPlanRecommendation | null; threeYears: SavingsPlanRecommendation | null };
  rdsReservations: ReservationRecommendation | null;
  savingsPlansCoverage: SavingsPlansCoverage | null;
  savingsPlansUtilization: SavingsPlansUtilization | null;
  reservationUtilization: ReservationUtilization | null;
  unavailable: string[];
}
