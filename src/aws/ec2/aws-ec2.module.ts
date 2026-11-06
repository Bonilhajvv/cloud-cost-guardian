import { Module } from '@nestjs/common';
import { AwsCoreModule } from '../core/aws-core.module';
import { Ec2AnalyzerService } from './ec2-analyzer.service';
import { Ec2Service } from './ec2.service';

@Module({
  imports: [AwsCoreModule],
  providers: [Ec2Service, Ec2AnalyzerService],
  exports: [Ec2Service, Ec2AnalyzerService],
})
export class AwsEc2Module {}
