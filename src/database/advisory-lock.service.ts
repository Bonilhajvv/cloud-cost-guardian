import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LockResult } from './interfaces/lock-result.interface';

@Injectable()
export class AdvisoryLockService {
  private readonly logger = new Logger(AdvisoryLockService.name);

  constructor(private readonly dataSource: DataSource) {}

  async tryWithLock<T>(key: string, fn: () => Promise<T>): Promise<LockResult<T>> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const rows: { locked: boolean }[] = await runner.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
        [key],
      );
      if (!rows[0]?.locked) {
        this.logger.log({ msg: 'Lock busy, skipping', key });
        return { acquired: false };
      }
      try {
        return { acquired: true, value: await fn() };
      } finally {
        await runner.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]);
      }
    } finally {
      await runner.release();
    }
  }
}
