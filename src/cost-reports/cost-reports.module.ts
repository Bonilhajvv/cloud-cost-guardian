import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AwsCostsModule } from '../aws/costs/aws-costs.module';
import { AwsDataExportsModule } from '../aws/data-exports/aws-data-exports.module';
import { CostReportsController } from './cost-reports.controller';
import { CostReportsService } from './cost-reports.service';
import { CostSyncService } from './cost-sync.service';
import { CostUsageService } from './cost-usage.service';
import { CostUsageDaily } from './entities/cost-usage-daily.entity';
import { CostSnapshot } from './entities/cost-snapshot.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CostSnapshot, CostUsageDaily]), AwsCostsModule, AwsDataExportsModule],
  controllers: [CostReportsController],
  providers: [CostReportsService, CostSyncService, CostUsageService],
  exports: [CostReportsService, CostSyncService, CostUsageService],
})
export class CostReportsModule {}
