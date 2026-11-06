import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { KubernetesMetricsService } from '../kubernetes/kubernetes-metrics.service';
import { CRON } from './constants/jobs.constant';

@Injectable()
export class KubernetesMaintenanceJob {
  private readonly logger = new Logger(KubernetesMaintenanceJob.name);

  constructor(private readonly metrics: KubernetesMetricsService) {}

  @Cron(CRON.kubernetesStale, { name: 'kubernetes-stale-check' })
  async markStale(): Promise<void> {
    const stale = await this.metrics.markStaleClusters();
    if (stale) this.logger.warn({ msg: 'Kubernetes clusters marked STALE (agent silent)', clusters: stale });
  }

  @Cron(CRON.kubernetesPurge, { name: 'kubernetes-sample-purge' })
  async purge(): Promise<void> {
    const removed = await this.metrics.purgeOldSamples();
    this.logger.log({ msg: 'Kubernetes usage samples purged', removed });
  }
}
