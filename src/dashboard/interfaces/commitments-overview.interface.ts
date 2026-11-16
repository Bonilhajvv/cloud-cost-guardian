export interface CommitmentsOverview {
  accountsWithData: number;
  onDemandMonthly: number | null;
  coveredMonthly: number | null;
  coveragePercentage: number | null;
  savingsPlansUtilization: number | null;
  unusedCommitmentMonthly: number;
  alerts: string[];
  oldestFetchedAt: string | null;
}
