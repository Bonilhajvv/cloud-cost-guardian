import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AwsCostsModule } from '../aws/costs/aws-costs.module';
import { CostReportsController } from './cost-reports.controller';
import { CostReportsService } from './cost-reports.service';
import { CostSyncService } from './cost-sync.service';
import { CostSnapshot } from './entities/cost-snapshot.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CostSnapshot]), AwsCostsModule],
  controllers: [CostReportsController],
  providers: [CostReportsService, CostSyncService],
  exports: [CostReportsService, CostSyncService],
})
export class CostReportsModule {}
