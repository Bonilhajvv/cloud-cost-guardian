import { Module } from '@nestjs/common';
import { AwsCoreModule } from '../core/aws-core.module';
import { SnapshotAnalyzerService } from './snapshot-analyzer.service';
import { SnapshotsService } from './snapshots.service';

@Module({
  imports: [AwsCoreModule],
  providers: [SnapshotsService, SnapshotAnalyzerService],
  exports: [SnapshotsService, SnapshotAnalyzerService],
})
export class AwsSnapshotsModule {}
