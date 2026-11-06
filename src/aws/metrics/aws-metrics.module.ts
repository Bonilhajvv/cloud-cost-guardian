import { Module } from '@nestjs/common';
import { AwsCoreModule } from '../core/aws-core.module';
import { CloudWatchService } from './cloudwatch.service';

@Module({
  imports: [AwsCoreModule],
  providers: [CloudWatchService],
  exports: [CloudWatchService],
})
export class AwsMetricsModule {}
