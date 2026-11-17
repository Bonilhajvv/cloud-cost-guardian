import { Module } from '@nestjs/common';
import { AwsAccountsModule } from '../aws-accounts/aws-accounts.module';
import { AwsModule } from '../aws/aws.module';
import { CostReportsModule } from '../cost-reports/cost-reports.module';
import { KubernetesModule } from '../kubernetes/kubernetes.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { ResourceInventoryModule } from '../resource-inventory/resource-inventory.module';
import { CommitmentSyncService } from './commitment-sync.service';
import { Ec2ScheduleScanService } from './ec2-schedule-scan.service';
import { KubernetesScanService } from './kubernetes-scan.service';
import { NetworkScanService } from './network-scan.service';
import { RdsScanService } from './rds-scan.service';
import { ScanOrchestratorService } from './scan-orchestrator.service';
import { ScansController } from './scans.controller';

@Module({
  imports: [AwsModule, AwsAccountsModule, ResourceInventoryModule, CostReportsModule, RecommendationsModule, KubernetesModule, OrganizationsModule],
  controllers: [ScansController],
  providers: [ScanOrchestratorService, RdsScanService, CommitmentSyncService, NetworkScanService, KubernetesScanService, Ec2ScheduleScanService],
  exports: [ScanOrchestratorService],
})
export class ScansModule {}
