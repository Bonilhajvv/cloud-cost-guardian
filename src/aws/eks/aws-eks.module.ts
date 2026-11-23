import { Module } from '@nestjs/common';
import { AwsCoreModule } from '../core/aws-core.module';
import { EksService } from './eks.service';

@Module({
  imports: [AwsCoreModule],
  providers: [EksService],
  exports: [EksService],
})
export class AwsEksModule {}
