import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { summary } from '../aws/metrics/helpers/build-utilization.helper';
import { round } from '../common/helpers/stats.helper';
import { KubernetesCluster } from './entities/kubernetes-cluster.entity';
import { KubernetesNode } from './entities/kubernetes-node.entity';
import { KubernetesUsageSample } from './entities/kubernetes-usage-sample.entity';
import { NodeMemoryStats } from './interfaces/kubernetes.interface';
import { KubernetesClusterStatus } from '../common/enums';
import { CLUSTER_STALE_AFTER_MS, GIB, NODE_STATS_DAYS, USAGE_SAMPLE_RETENTION_DAYS } from './constants/kubernetes.constant';

@Injectable()
export class KubernetesMetricsService {
  constructor(
    @InjectRepository(KubernetesUsageSample) private readonly samples: Repository<KubernetesUsageSample>,
    @InjectRepository(KubernetesNode) private readonly nodes: Repository<KubernetesNode>,
    @InjectRepository(KubernetesCluster) private readonly clusters: Repository<KubernetesCluster>,
  ) {}

  async nodeMemoryStats(organizationId: string, instanceIds: string[]): Promise<Map<string, NodeMemoryStats>> {
    const out = new Map<string, NodeMemoryStats>();
    if (instanceIds.length === 0) return out;
    const nodes = await this.nodes.find({
      where: { organizationId, instanceId: In(instanceIds) },
      relations: { cluster: true },
    });
    if (nodes.length === 0) return out;

    const since = new Date(Date.now() - NODE_STATS_DAYS * 24 * 60 * 60 * 1000);
    const hourly = await this.samples
      .createQueryBuilder('s')
      .select('s.instanceId', 'instanceId')
      .addSelect(`date_trunc('hour', s.sampledAt)`, 'hour')
      .addSelect('AVG(s.memoryBytes)', 'avg')
      .addSelect('MAX(s.memoryBytes)', 'max')
      .where('s.organizationId = :organizationId', { organizationId })
      .andWhere('s.instanceId IN (:...ids)', { ids: nodes.map((n) => n.instanceId) })
      .andWhere('s.sampledAt >= :since', { since })
      .andWhere('s.memoryBytes IS NOT NULL')
      .groupBy('s.instanceId')
      .addGroupBy('hour')
      .getRawMany<{ instanceId: string; avg: string; max: string }>();

    for (const node of nodes) {
      if (!node.instanceId || !node.capacityMemoryBytes) continue;
      const rows = hourly.filter((h) => h.instanceId === node.instanceId);
      if (rows.length === 0) continue;
      const capacity = node.capacityMemoryBytes;
      out.set(node.instanceId, {
        instanceId: node.instanceId,
        clusterId: node.clusterId,
        clusterName: node.cluster.name,
        nodeName: node.nodeName,
        role: node.role,
        provider: node.cluster.provider,
        usedPercent: summary(
          rows.map((r) => (Number(r.avg) / capacity) * 100),
          rows.map((r) => (Number(r.max) / capacity) * 100),
        ),
        requestsPercent: node.requestsMemoryBytes !== null ? round((node.requestsMemoryBytes / capacity) * 100) : null,
        allocatableGb: node.allocatableMemoryBytes !== null ? round(node.allocatableMemoryBytes / GIB) : null,
      });
    }
    return out;
  }

  async markStaleClusters(): Promise<number> {
    const result = await this.clusters.update(
      { status: KubernetesClusterStatus.CONNECTED, lastSeenAt: LessThan(new Date(Date.now() - CLUSTER_STALE_AFTER_MS)) },
      { status: KubernetesClusterStatus.STALE },
    );
    return result.affected ?? 0;
  }

  async purgeOldSamples(): Promise<number> {
    const cutoff = new Date(Date.now() - USAGE_SAMPLE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const result = await this.samples.delete({ sampledAt: LessThan(cutoff) });
    return result.affected ?? 0;
  }
}
