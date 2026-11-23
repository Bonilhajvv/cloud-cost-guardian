import { Module } from '@nestjs/common';
import { AwsCoreModule } from '../core/aws-core.module';
import { LambdaAnalyzerService } from './lambda-analyzer.service';
import { LambdaService } from './lambda.service';

@Module({
  imports: [AwsCoreModule],
  providers: [LambdaService, LambdaAnalyzerService],
  exports: [LambdaService, LambdaAnalyzerService],
})
export class AwsLambdaModule {}
