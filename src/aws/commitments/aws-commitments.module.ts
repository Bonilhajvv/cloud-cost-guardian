import { Module } from '@nestjs/common';
import { CommitmentAnalyzerService } from './commitment-analyzer.service';

@Module({
  providers: [CommitmentAnalyzerService],
  exports: [CommitmentAnalyzerService],
})
export class AwsCommitmentsModule {}
