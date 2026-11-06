import { Module } from '@nestjs/common';
import { AwsCoreModule } from './core/aws-core.module';
import { AwsCostsModule } from './costs/aws-costs.module';
import { AwsEbsModule } from './ebs/aws-ebs.module';
import { AwsEc2Module } from './ec2/aws-ec2.module';
import { AwsMetricsModule } from './metrics/aws-metrics.module';
import { AwsOptimizerModule } from './optimizer/aws-optimizer.module';
import { AwsPricingModule } from './pricing/aws-pricing.module';
import { AwsResourcesModule } from './resources/aws-resources.module';

const modules = [
  AwsCoreModule,
  AwsResourcesModule,
  AwsEc2Module,
  AwsEbsModule,
  AwsMetricsModule,
  AwsCostsModule,
  AwsOptimizerModule,
  AwsPricingModule,
];

@Module({
  imports: modules,
  exports: modules,
})
export class AwsModule {}
