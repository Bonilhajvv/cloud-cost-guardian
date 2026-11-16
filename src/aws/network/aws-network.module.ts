import { Module } from '@nestjs/common';
import { AwsCoreModule } from '../core/aws-core.module';
import { NetworkAnalyzerService } from './network-analyzer.service';
import { NetworkService } from './network.service';

@Module({
  imports: [AwsCoreModule],
  providers: [NetworkService, NetworkAnalyzerService],
  exports: [NetworkService, NetworkAnalyzerService],
})
export class AwsNetworkModule {}
