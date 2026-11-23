import { Module } from '@nestjs/common';
import { AwsCoreModule } from '../core/aws-core.module';
import { AuroraAnalyzerService } from './aurora-analyzer.service';
import { RdsBackupAnalyzerService } from './rds-backup-analyzer.service';
import { RdsAnalyzerService } from './rds-analyzer.service';
import { RdsService } from './rds.service';

@Module({
  imports: [AwsCoreModule],
  providers: [RdsService, RdsAnalyzerService, RdsBackupAnalyzerService, AuroraAnalyzerService],
  exports: [RdsService, RdsAnalyzerService, RdsBackupAnalyzerService, AuroraAnalyzerService],
})
export class AwsRdsModule {}
