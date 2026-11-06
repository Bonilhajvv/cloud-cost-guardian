import { Module } from '@nestjs/common';
import { AwsCoreModule } from '../core/aws-core.module';
import { ResourceExplorerService } from './resource-explorer.service';

@Module({
  imports: [AwsCoreModule],
  providers: [ResourceExplorerService],
  exports: [ResourceExplorerService],
})
export class AwsResourcesModule {}
