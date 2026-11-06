export interface AdminStats {
  totalOrganizations: number;
  activeOrganizations: number;
  suspendedOrganizations: number;
  totalUsers: number;
  awsAccountsTotal: number;
  awsAccountsConnected: number;
  resourcesMonitored: number;
  awsSpendMonitoredMonthToDate: number;
  potentialSavingsMonthly: number;
  potentialSavingsAnnual: number;
  recommendationsGenerated: number;
  integrationErrors: number;
  scanFailuresLast24h: number;
  currency: string;
}

export interface AdminOrganizationRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: Date;
  users: number;
  awsAccounts: number;
}
