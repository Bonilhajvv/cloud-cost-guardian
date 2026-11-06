import { Module } from '@nestjs/common';
import { AwsCoreModule } from '../core/aws-core.module';
import { EbsAnalyzerService } from './ebs-analyzer.service';
import { EbsService } from './ebs.service';

@Module({
  imports: [AwsCoreModule],
  providers: [EbsService, EbsAnalyzerService],
  exports: [EbsService, EbsAnalyzerService],
})
export class AwsEbsModule {}
