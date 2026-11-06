import { ScheduledJob } from '../interfaces/scheduled-job.interface';

const HOUR = 60 * 60 * 1000;

export const SCHEDULED_JOBS: Record<'resources' | 'costs' | 'optimizer', ScheduledJob> = {
  resources: { name: 'aws-resource-scan', step: 'RESOURCES', freshnessField: 'lastScanAt', minIntervalMs: 3 * HOUR },
  costs: { name: 'aws-cost-sync', step: 'COSTS', freshnessField: 'lastCostSyncAt', minIntervalMs: 3 * HOUR },
  optimizer: { name: 'aws-compute-optimizer-sync', step: 'OPTIMIZER', freshnessField: 'lastOptimizerSyncAt', minIntervalMs: 12 * HOUR },
};

export const CRON = {
  resources: '0 */6 * * *',
  costs: '30 */6 * * *',
  optimizer: '0 3 * * *',
  kubernetesStale: '*/5 * * * *',
  kubernetesPurge: '0 4 * * *',
} as const;
