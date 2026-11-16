import { Module } from '@nestjs/common';
import { AwsCoreModule } from '../core/aws-core.module';
import { RdsAnalyzerService } from './rds-analyzer.service';
import { RdsService } from './rds.service';

@Module({
  imports: [AwsCoreModule],
  providers: [RdsService, RdsAnalyzerService],
  exports: [RdsService, RdsAnalyzerService],
})
export class AwsRdsModule {}
