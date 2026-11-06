import { Module } from '@nestjs/common';
import { AwsAccountsModule } from '../aws-accounts/aws-accounts.module';
import { CostReportsModule } from '../cost-reports/cost-reports.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { ResourceInventoryModule } from '../resource-inventory/resource-inventory.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [CostReportsModule, RecommendationsModule, AwsAccountsModule, ResourceInventoryModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
