import { CostSummary } from '../../cost-reports/interfaces/cost-report.interface';
import { SavingsSummary, TopOpportunity } from '../../recommendations/interfaces/savings-summary.interface';
import { MetricsCoverage } from '../../resource-inventory/interfaces/metrics-coverage.interface';

export interface DashboardSummary {
  awsMonthlyCost: CostSummary;
  savings: SavingsSummary;
  topOpportunities: TopOpportunity[];
  awsAccounts: Record<string, number>;
  resources: { total: number; ec2: number };
  metricsCoverage: MetricsCoverage;
}
