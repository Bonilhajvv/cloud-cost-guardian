import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThan, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditAction, KubernetesClusterStatus } from '../common/enums';
import { chunk } from '../common/helpers/stats.helper';
import { ResourceInventoryService } from '../resource-inventory/resource-inventory.service';
import { GIB, INGEST_BATCH_SIZE } from './constants/kubernetes.constant';
import { AgentReportDto, ReportNodeDto } from './dto/agent-report.dto';
import { KubernetesCluster } from './entities/kubernetes-cluster.entity';
import { KubernetesNode } from './entities/kubernetes-node.entity';
import { KubernetesUsageSample } from './entities/kubernetes-usage-sample.entity';
import { KubernetesWorkload } from './entities/kubernetes-workload.entity';
import { detectProvider, instanceIdFromProviderId } from './helpers/provider.helper';
import { AgentPrincipal } from './interfaces/kubernetes.interface';

@Injectable()
export class KubernetesIngestService {
  private readonly logger = new Logger(KubernetesIngestService.name);

  constructor(
    @InjectRepository(KubernetesCluster) private readonly clusters: Repository<KubernetesCluster>,
    private readonly inventory: ResourceInventoryService,
    private readonly audit: AuditService,
  ) {}

  async ingest(agent: AgentPrincipal, report: AgentReportDto): Promise<{ accepted: true; nodes: number; workloads: number; linkedInstances: number }> {
    const seenAt = new Date();
    const cluster = await this.clusters.findOneByOrFail({ id: agent.clusterId });
    const firstConnection = cluster.connectedAt === null;
    const podCount = report.nodes.reduce((s, n) => s + n.podCount, 0);

    await this.clusters.manager.transaction(async (manager) => {
      await manager.update(KubernetesCluster, { id: cluster.id }, {
        status: KubernetesClusterStatus.CONNECTED,
        provider: detectProvider(report.nodes),
        installMethod: report.installMethod,
        agentVersion: report.agentVersion,
        kubernetesVersion: report.kubernetesVersion,
        metricsServerAvailable: report.metricsServerAvailable,
        nodeCount: report.nodes.length,
        podCount,
        lastSeenAt: seenAt,
        connectedAt: cluster.connectedAt ?? seenAt,
        installTokenHash: null,
        installTokenExpiresAt: null,
      });
      await this.upsertNodes(manager, agent, report.nodes, seenAt);
      await this.upsertWorkloads(manager, agent, report, seenAt);
      await manager.delete(KubernetesNode, { clusterId: cluster.id, lastSeenAt: LessThan(seenAt) });
      await manager.delete(KubernetesWorkload, { clusterId: cluster.id, lastSeenAt: LessThan(seenAt) });
      await this.insertSamples(manager, agent, report.nodes, seenAt);
    });

    const linkedInstances = await this.linkInstances(agent, cluster.name, report.nodes);

    if (firstConnection) {
      await this.audit.log({
        action: AuditAction.KUBERNETES_CONNECTED,
        organizationId: agent.organizationId,
        targetType: 'KubernetesCluster',
        targetId: cluster.id,
        metadata: { nodes: report.nodes.length, provider: detectProvider(report.nodes), installMethod: report.installMethod },
      });
      this.logger.log({ msg: 'Kubernetes cluster connected', clusterId: cluster.id, organizationId: agent.organizationId });
    }
    this.logger.log({
      msg: 'Kubernetes report ingested',
      clusterId: cluster.id,
      nodes: report.nodes.length,
      workloads: report.workloads.length,
      pods: podCount,
      linkedInstances,
      metricsServer: report.metricsServerAvailable,
    });
    return { accepted: true, nodes: report.nodes.length, workloads: report.workloads.length, linkedInstances };
  }

  private async upsertNodes(manager: EntityManager, agent: AgentPrincipal, nodes: ReportNodeDto[], seenAt: Date): Promise<void> {
    for (const batch of chunk(nodes, INGEST_BATCH_SIZE)) {
      await manager
        .createQueryBuilder()
        .insert()
        .into(KubernetesNode)
        .values(
          batch.map((n) => ({
            organizationId: agent.organizationId,
            clusterId: agent.clusterId,
            nodeName: n.name,
            providerId: n.providerId ?? null,
            instanceId: instanceIdFromProviderId(n.providerId),
            instanceType: n.instanceType ?? null,
            role: n.role,
            capacityCpu: n.capacity.cpuCores ?? null,
            capacityMemoryBytes: n.capacity.memoryBytes ?? null,
            allocatableCpu: n.allocatable.cpuCores ?? null,
            allocatableMemoryBytes: n.allocatable.memoryBytes ?? null,
            requestsCpu: n.requests.cpuCores ?? null,
            requestsMemoryBytes: n.requests.memoryBytes ?? null,
            limitsCpu: n.limits.cpuCores ?? null,
            limitsMemoryBytes: n.limits.memoryBytes ?? null,
            usageCpu: n.usage?.cpuCores ?? null,
            usageMemoryBytes: n.usage?.memoryBytes ?? null,
            podCount: n.podCount,
            labels: n.labels ?? {},
            lastSeenAt: seenAt,
          })),
        )
        .orUpdate(
          ['providerId', 'instanceId', 'instanceType', 'role', 'capacityCpu', 'capacityMemoryBytes', 'allocatableCpu', 'allocatableMemoryBytes', 'requestsCpu', 'requestsMemoryBytes', 'limitsCpu', 'limitsMemoryBytes', 'usageCpu', 'usageMemoryBytes', 'podCount', 'labels', 'lastSeenAt'],
          ['clusterId', 'nodeName'],
        )
        .execute();
    }
  }

  private async upsertWorkloads(manager: EntityManager, agent: AgentPrincipal, report: AgentReportDto, seenAt: Date): Promise<void> {
    for (const batch of chunk(report.workloads, INGEST_BATCH_SIZE)) {
      await manager
        .createQueryBuilder()
        .insert()
        .into(KubernetesWorkload)
        .values(
          batch.map((w) => ({
            organizationId: agent.organizationId,
            clusterId: agent.clusterId,
            namespace: w.namespace,
            kind: w.kind,
            name: w.name,
            desiredReplicas: w.desiredReplicas ?? null,
            podCount: w.podCount,
            requestsCpu: w.requests.cpuCores ?? null,
            requestsMemoryBytes: w.requests.memoryBytes ?? null,
            limitsCpu: w.limits.cpuCores ?? null,
            limitsMemoryBytes: w.limits.memoryBytes ?? null,
            usageCpu: w.usage?.cpuCores ?? null,
            usageMemoryBytes: w.usage?.memoryBytes ?? null,
            hpa: w.hpa ? { minReplicas: w.hpa.minReplicas ?? null, maxReplicas: w.hpa.maxReplicas } : null,
            lastSeenAt: seenAt,
          })),
        )
        .orUpdate(
          ['desiredReplicas', 'podCount', 'requestsCpu', 'requestsMemoryBytes', 'limitsCpu', 'limitsMemoryBytes', 'usageCpu', 'usageMemoryBytes', 'hpa', 'lastSeenAt'],
          ['clusterId', 'namespace', 'kind', 'name'],
        )
        .execute();
    }
  }

  private async insertSamples(manager: EntityManager, agent: AgentPrincipal, nodes: ReportNodeDto[], seenAt: Date): Promise<void> {
    const rows = nodes
      .filter((n) => n.usage)
      .map((n) => ({
        organizationId: agent.organizationId,
        clusterId: agent.clusterId,
        nodeName: n.name,
        instanceId: instanceIdFromProviderId(n.providerId),
        cpuCores: n.usage?.cpuCores ?? null,
        memoryBytes: n.usage?.memoryBytes ?? null,
        requestsMemoryBytes: n.requests.memoryBytes ?? null,
        allocatableMemoryBytes: n.allocatable.memoryBytes ?? null,
        sampledAt: seenAt,
      }));
    for (const batch of chunk(rows, INGEST_BATCH_SIZE)) await manager.insert(KubernetesUsageSample, batch);
  }

  private async linkInstances(agent: AgentPrincipal, clusterName: string, nodes: ReportNodeDto[]): Promise<number> {
    const byInstance = new Map(
      nodes.flatMap((n) => {
        const id = instanceIdFromProviderId(n.providerId);
        return id ? [[id, n] as const] : [];
      }),
    );
    const resources = await this.inventory.findByResourceIds(agent.organizationId, [...byInstance.keys()]);
    for (const r of resources) {
      const n = byInstance.get(r.resourceId);
      if (!n) continue;
      await this.inventory.patchMetadata(r.awsAccountId, r.resourceId, {
        kubernetesNode: {
          clusterId: agent.clusterId,
          clusterName,
          nodeName: n.name,
          role: n.role,
          podCount: n.podCount,
          allocatableMemoryGb: n.allocatable.memoryBytes ? Math.round((n.allocatable.memoryBytes / GIB) * 100) / 100 : null,
          requestsMemoryGb: n.requests.memoryBytes ? Math.round((n.requests.memoryBytes / GIB) * 100) / 100 : null,
          usageMemoryGb: n.usage?.memoryBytes ? Math.round((n.usage.memoryBytes / GIB) * 100) / 100 : null,
          reportedAt: new Date().toISOString(),
        },
      });
    }
    return resources.length;
  }
}
