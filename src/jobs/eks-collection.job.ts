import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EksConnectionsService } from '../kubernetes/eks-connections.service';
import { CRON } from './constants/jobs.constant';

@Injectable()
export class EksCollectionJob {
  private readonly logger = new Logger(EksCollectionJob.name);
  private running = false;

  constructor(private readonly connections: EksConnectionsService) {}

  @Cron(CRON.eksCollection, { name: 'eks-collection' })
  async collect(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const stats = await this.connections.collectAll();
      if (stats.collected || stats.failed) this.logger.log({ msg: 'EKS collection finished', ...stats });
    } catch (error) {
      this.logger.error({ msg: 'EKS collection crashed' }, error instanceof Error ? error.stack : String(error));
    } finally {
      this.running = false;
    }
  }
}
