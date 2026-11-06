import { Module } from '@nestjs/common';
import { AwsAccountsModule } from '../aws-accounts/aws-accounts.module';
import { AwsModule } from '../aws/aws.module';
import { CostReportsModule } from '../cost-reports/cost-reports.module';
import { KubernetesModule } from '../kubernetes/kubernetes.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { ResourceInventoryModule } from '../resource-inventory/resource-inventory.module';
import { ScanOrchestratorService } from './scan-orchestrator.service';
import { ScansController } from './scans.controller';

@Module({
  imports: [AwsModule, AwsAccountsModule, ResourceInventoryModule, CostReportsModule, RecommendationsModule, KubernetesModule],
  controllers: [ScansController],
  providers: [ScanOrchestratorService],
  exports: [ScanOrchestratorService],
})
export class ScansModule {}
