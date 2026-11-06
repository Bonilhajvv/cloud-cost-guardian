export interface SavingsSummary {
  currency: string;
  potentialMonthly: number;
  potentialAnnual: number;
  acceptedMonthly: number;
  implementedMonthly: number;
  realizedMonthly: number;
  openRecommendations: number;
}

export interface TopOpportunity {
  label: string;
  monthlySavings: number;
  count: number;
}

export interface DraftSyncResult {
  created: number;
  updated: number;
  resolved: number;
  skipped: number;
}
