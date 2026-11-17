import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { summary } from '../aws/metrics/helpers/build-utilization.helper';
import { addDays, toIsoDate, todayUtc } from '../common/helpers/date.helper';
import { round } from '../common/helpers/stats.helper';
import { KubernetesCluster } from './entities/kubernetes-cluster.entity';
import { KubernetesContainerUsageDaily } from './entities/kubernetes-container-usage-daily.entity';
import { KubernetesNode } from './entities/kubernetes-node.entity';
import { KubernetesUsageSample } from './entities/kubernetes-usage-sample.entity';
import { KubernetesWorkload } from './entities/kubernetes-workload.entity';
import { KubernetesWorkloadUsageDaily } from './entities/kubernetes-workload-usage-daily.entity';
import { ClusterAnalysisData, UsagePeak } from './interfaces/kubernetes-analysis.interface';
import { NodeDiskStats, NodeMemoryStats } from './interfaces/kubernetes.interface';
import { KubernetesClusterStatus } from '../common/enums';
import { CLUSTER_STALE_AFTER_MS, GIB, NODE_STATS_DAYS, USAGE_SAMPLE_RETENTION_DAYS } from './constants/kubernetes.constant';
import { KubernetesNodeRef } from '../aws/ec2/interfaces/ec2-analysis.interface';

@Injectable()
export class KubernetesMetricsService {
  constructor(
    @InjectRepository(KubernetesUsageSample) private readonly samples: Repository<KubernetesUsageSample>,
    @InjectRepository(KubernetesNode) private readonly nodes: Repository<KubernetesNode>,
    @InjectRepository(KubernetesCluster) private readonly clusters: Repository<KubernetesCluster>,
    @InjectRepository(KubernetesWorkload) private readonly workloads: Repository<KubernetesWorkload>,
    @InjectRepository(KubernetesWorkloadUsageDaily) private readonly workloadUsage: Repository<KubernetesWorkloadUsageDaily>,
    @InjectRepository(KubernetesContainerUsageDaily) private readonly containerUsage: Repository<KubernetesContainerUsageDaily>,
  ) {}

  async analysisData(organizationId: string, awsAccountId: string, days: number): Promise<ClusterAnalysisData[]> {
    const clusters = await this.clusters.find({ where: { organizationId, awsAccountId } });
    if (clusters.length === 0) return [];
    const ids = clusters.map((c) => c.id);
    const since = addDays(todayUtc(), -days);
    const [nodes, workloads, workloadPeaks, nodePeaks, containerPeaks] = await Promise.all([
      this.nodes.find({ where: { clusterId: In(ids) } }),
      this.workloads.find({ where: { clusterId: In(ids) } }),
      this.workloadUsage
        .createQueryBuilder('u')
        .select('u.clusterId', 'clusterId')
        .addSelect('u.namespace', 'namespace')
        .addSelect('u.kind', 'kind')
        .addSelect('u.name', 'name')
        .addSelect('MAX(u.maxCpuPerPod)', 'cpu')
        .addSelect('MAX(u.maxMemoryPerPodBytes)', 'memory')
        .addSelect('COUNT(*)', 'days')
        .where('u.clusterId IN (:...ids)', { ids })
        .andWhere('u.day >= :since', { since: toIsoDate(since) })
        .groupBy('u.clusterId')
        .addGroupBy('u.namespace')
        .addGroupBy('u.kind')
        .addGroupBy('u.name')
        .getRawMany<{ clusterId: string; namespace: string; kind: string; name: string; cpu: string | null; memory: string | null; days: string }>(),
      this.samples
        .createQueryBuilder('s')
        .select('s.clusterId', 'clusterId')
        .addSelect('s.nodeName', 'nodeName')
        .addSelect('MAX(s.requestsCpu)', 'cpu')
        .addSelect('MAX(s.requestsMemoryBytes)', 'memory')
        .addSelect(`COUNT(DISTINCT date_trunc('day', s.sampledAt)) FILTER (WHERE s.requestsCpu IS NOT NULL)`, 'days')
        .where('s.clusterId IN (:...ids)', { ids })
        .andWhere('s.sampledAt >= :since', { since })
        .groupBy('s.clusterId')
        .addGroupBy('s.nodeName')
        .getRawMany<{ clusterId: string; nodeName: string; cpu: string | null; memory: string | null; days: string }>(),
      this.containerUsage
        .createQueryBuilder('c')
        .select('c.clusterId', 'clusterId')
        .addSelect('c.namespace', 'namespace')
        .addSelect('c.kind', 'kind')
        .addSelect('c.name', 'name')
        .addSelect('c.container', 'container')
        .addSelect('MAX(c.maxCpuCores)', 'cpu')
        .addSelect('MAX(c.maxMemoryBytes)', 'memory')
        .addSelect('COUNT(*)', 'days')
        .where('c.clusterId IN (:...ids)', { ids })
        .andWhere('c.day >= :since', { since: toIsoDate(since) })
        .groupBy('c.clusterId')
        .addGroupBy('c.namespace')
        .addGroupBy('c.kind')
        .addGroupBy('c.name')
        .addGroupBy('c.container')
        .getRawMany<{ clusterId: string; namespace: string; kind: string; name: string; container: string; cpu: string | null; memory: string | null; days: string }>(),
    ]);
    const num = (v: string | null) => (v === null ? null : Number(v));
    const higher = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));
    const workloadPeak = new Map(workloadPeaks.map((p) => [`${p.clusterId}|${p.namespace}|${p.kind}|${p.name}`, { cpuCores: num(p.cpu), memoryBytes: num(p.memory), days: Number(p.days) }]));
    const nodePeak = new Map(nodePeaks.map((p) => [`${p.clusterId}|${p.nodeName}`, p]));
    const containerPeak = new Map<string, Map<string, UsagePeak>>();
    for (const p of containerPeaks) {
      const key = `${p.clusterId}|${p.namespace}|${p.kind}|${p.name}`;
      const byName = containerPeak.get(key) ?? new Map<string, UsagePeak>();
      byName.set(p.container, { cpuCores: num(p.cpu), memoryBytes: num(p.memory), days: Number(p.days) });
      containerPeak.set(key, byName);
    }
    return clusters.map((cluster) => ({
      cluster,
      workloads: workloads
        .filter((w) => w.clusterId === cluster.id)
        .map((workload) => {
          const key = `${cluster.id}|${workload.namespace}|${workload.kind}|${workload.name}`;
          return { workload, peak: workloadPeak.get(key) ?? null, containerPeaks: containerPeak.get(key) ?? new Map<string, UsagePeak>() };
        }),
      nodes: nodes
        .filter((n) => n.clusterId === cluster.id)
        .map((node) => {
          const p = nodePeak.get(`${cluster.id}|${node.nodeName}`);
          return {
            node,
            peakRequests: {
              cpuCores: higher(node.requestsCpu, num(p?.cpu ?? null)),
              memoryBytes: higher(node.requestsMemoryBytes, num(p?.memory ?? null)),
              days: p ? Number(p.days) : 0,
            },
          };
        }),
    }));
  }

  async nodesByInstanceIds(organizationId: string, instanceIds: string[]): Promise<Map<string, KubernetesNodeRef>> {
    if (instanceIds.length === 0) return new Map();
    const nodes = await this.nodes.find({ where: { organizationId, instanceId: In(instanceIds) }, relations: { cluster: true } });
    return new Map(nodes.flatMap((n) => (n.instanceId ? [[n.instanceId, { clusterName: n.cluster.name, nodeName: n.nodeName }] as const] : [])));
  }

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

  async nodeDiskStats(organizationId: string, instanceIds: string[]): Promise<Map<string, NodeDiskStats>> {
    if (instanceIds.length === 0) return new Map();
    const since = new Date(Date.now() - NODE_STATS_DAYS * 24 * 60 * 60 * 1000);
    const hourly = await this.samples
      .createQueryBuilder('s')
      .select('s.instanceId', 'instanceId')
      .addSelect(`date_trunc('hour', s.sampledAt)`, 'hour')
      .addSelect('AVG(s.fsUsedBytes * 100.0 / s.fsCapacityBytes)', 'avg')
      .addSelect('MAX(s.fsUsedBytes * 100.0 / s.fsCapacityBytes)', 'max')
      .where('s.organizationId = :organizationId', { organizationId })
      .andWhere('s.instanceId IN (:...ids)', { ids: instanceIds })
      .andWhere('s.sampledAt >= :since', { since })
      .andWhere('s.fsCapacityBytes > 0')
      .groupBy('s.instanceId')
      .addGroupBy('hour')
      .getRawMany<{ instanceId: string; avg: string; max: string }>();
    const byInstance = new Map<string, { avg: number[]; max: number[] }>();
    for (const row of hourly) {
      const series = byInstance.get(row.instanceId) ?? { avg: [], max: [] };
      series.avg.push(Number(row.avg));
      series.max.push(Number(row.max));
      byInstance.set(row.instanceId, series);
    }
    return new Map([...byInstance].map(([instanceId, s]) => [instanceId, { instanceId, usedPercent: summary(s.avg, s.max) }]));
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
    const daily = await this.workloadUsage.delete({ day: LessThan(toIsoDate(cutoff)) });
    const containers = await this.containerUsage.delete({ day: LessThan(toIsoDate(cutoff)) });
    return (result.affected ?? 0) + (daily.affected ?? 0) + (containers.affected ?? 0);
  }
}
