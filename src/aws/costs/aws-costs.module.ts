import { Module } from '@nestjs/common';
import { AwsCoreModule } from '../core/aws-core.module';
import { CostExplorerService } from './cost-explorer.service';

@Module({
  imports: [AwsCoreModule],
  providers: [CostExplorerService],
  exports: [CostExplorerService],
})
export class AwsCostsModule {}
