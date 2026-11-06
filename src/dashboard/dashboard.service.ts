import { Injectable } from '@nestjs/common';
import { AwsAccountsService } from '../aws-accounts/aws-accounts.service';
import { CostReportsService } from '../cost-reports/cost-reports.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { ResourceInventoryService } from '../resource-inventory/resource-inventory.service';
import { DashboardSummary } from './interfaces/dashboard-summary.interface';

@Injectable()
export class DashboardService {
  constructor(
    private readonly costs: CostReportsService,
    private readonly recommendations: RecommendationsService,
    private readonly accounts: AwsAccountsService,
    private readonly inventory: ResourceInventoryService,
  ) {}

  async summary(organizationId: string): Promise<DashboardSummary> {
    const [awsMonthlyCost, savings, topOpportunities, accountRows, resources, metricsCoverage] = await Promise.all([
      this.costs.summary(organizationId),
      this.recommendations.savingsSummary(organizationId),
      this.recommendations.topOpportunities(organizationId),
      this.accounts.countByOrganization(organizationId),
      this.inventory.countByOrganization(organizationId),
      this.inventory.metricsCoverage(organizationId),
    ]);
    return {
      awsMonthlyCost,
      savings,
      topOpportunities,
      awsAccounts: Object.fromEntries(accountRows.map((r) => [r.status, Number(r.count)])),
      resources,
      metricsCoverage,
    };
  }
}
