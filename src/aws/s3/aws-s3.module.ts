import { Module } from '@nestjs/common';
import { AwsCoreModule } from '../core/aws-core.module';
import { S3AnalyzerService } from './s3-analyzer.service';
import { S3Service } from './s3.service';

@Module({
  imports: [AwsCoreModule],
  providers: [S3Service, S3AnalyzerService],
  exports: [S3Service, S3AnalyzerService],
})
export class AwsS3Module {}
