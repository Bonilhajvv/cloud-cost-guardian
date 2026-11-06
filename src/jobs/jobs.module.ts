import { Module } from '@nestjs/common';
import { AwsAccountsModule } from '../aws-accounts/aws-accounts.module';
import { KubernetesModule } from '../kubernetes/kubernetes.module';
import { ScansModule } from '../scans/scans.module';
import { KubernetesMaintenanceJob } from './kubernetes-maintenance.job';
import { ScanJobsService } from './scan-jobs.service';

@Module({
  imports: [AwsAccountsModule, ScansModule, KubernetesModule],
  providers: [ScanJobsService, KubernetesMaintenanceJob],
})
export class JobsModule {}
