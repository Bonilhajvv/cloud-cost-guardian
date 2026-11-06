import { Global, Module } from '@nestjs/common';
import { AdvisoryLockService } from './advisory-lock.service';

@Global()
@Module({
  providers: [AdvisoryLockService],
  exports: [AdvisoryLockService],
})
export class DatabaseModule {}
