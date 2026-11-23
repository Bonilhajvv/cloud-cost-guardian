import { Module } from '@nestjs/common';
import { AwsCoreModule } from '../core/aws-core.module';
import { DataExportsService } from './data-exports.service';

@Module({
  imports: [AwsCoreModule],
  providers: [DataExportsService],
  exports: [DataExportsService],
})
export class AwsDataExportsModule {}
