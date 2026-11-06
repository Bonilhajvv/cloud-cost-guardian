import { Module } from '@nestjs/common';
import { AwsCoreModule } from '../core/aws-core.module';
import { ComputeOptimizerService } from './compute-optimizer.service';

@Module({
  imports: [AwsCoreModule],
  providers: [ComputeOptimizerService],
  exports: [ComputeOptimizerService],
})
export class AwsOptimizerModule {}
