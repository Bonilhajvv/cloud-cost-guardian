import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AwsAccountsService } from '../aws-accounts/aws-accounts.service';
import { ScanOrchestratorService } from '../scans/scan-orchestrator.service';
import { CRON, SCHEDULED_JOBS } from './constants/jobs.constant';
import { ScheduledJob } from './interfaces/scheduled-job.interface';

@Injectable()
export class ScanJobsService {
  private readonly logger = new Logger(ScanJobsService.name);
  private readonly running = new Set<string>();

  constructor(
    private readonly accounts: AwsAccountsService,
    private readonly orchestrator: ScanOrchestratorService,
  ) {}

  @Cron(CRON.resources, { name: SCHEDULED_JOBS.resources.name })
  resourceScan(): Promise<void> {
    return this.execute(SCHEDULED_JOBS.resources);
  }

  @Cron(CRON.costs, { name: SCHEDULED_JOBS.costs.name })
  costSync(): Promise<void> {
    return this.execute(SCHEDULED_JOBS.costs);
  }

  @Cron(CRON.optimizer, { name: SCHEDULED_JOBS.optimizer.name })
  optimizerSync(): Promise<void> {
    return this.execute(SCHEDULED_JOBS.optimizer);
  }

  async execute(job: ScheduledJob): Promise<void> {
    if (this.running.has(job.name)) {
      this.logger.warn({ msg: 'Job still running, skipping tick', job: job.name });
      return;
    }
    this.running.add(job.name);
    const started = Date.now();
    const stats = { accounts: 0, ran: 0, skippedFresh: 0, skippedLocked: 0, failed: 0 };
    try {
      const accounts = await this.accounts.findSchedulable();
      stats.accounts = accounts.length;
      this.logger.log({ msg: 'Job started', job: job.name, accounts: accounts.length });
      for (const account of accounts) {
        const last = account[job.freshnessField];
        if (last && Date.now() - last.getTime() < job.minIntervalMs) {
          stats.skippedFresh++;
          continue;
        }
        const report = await this.orchestrator.run(account, [job.step, 'ANALYSIS'], 'SCHEDULED');
        if (report.status === 'SKIPPED_LOCKED') stats.skippedLocked++;
        else if (report.status === 'FAILED') stats.failed++;
        else stats.ran++;
      }
    } catch (error) {
      this.logger.error({ msg: 'Job crashed', job: job.name }, error instanceof Error ? error.stack : String(error));
    } finally {
      this.running.delete(job.name);
      this.logger.log({ msg: 'Job finished', job: job.name, durationMs: Date.now() - started, ...stats });
    }
  }
}
