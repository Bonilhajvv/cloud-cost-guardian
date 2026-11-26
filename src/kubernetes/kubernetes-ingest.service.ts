import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThan, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditAction, KubernetesClusterStatus } from '../common/enums';
import { toIsoDate } from '../common/helpers/date.helper';
import { chunk } from '../common/helpers/stats.helper';
import { ResourceInventoryService } from '../resource-inventory/resource-inventory.service';
import { GIB, INGEST_BATCH_SIZE } from './constants/kubernetes.constant';
import { AgentReportDto, ReportNodeDto } from './dto/agent-report.dto';
import { KubernetesCluster } from './entities/kubernetes-cluster.entity';
import { KubernetesContainerUsageDaily } from './entities/kubernetes-container-usage-daily.entity';
import { KubernetesNode } from './entities/kubernetes-node.entity';
import { KubernetesRouteHopUsageHourly } from './entities/kubernetes-route-hop-usage-hourly.entity';
import { KubernetesRouteUsageHourly } from './entities/kubernetes-route-usage-hourly.entity';
import { requestUsageRows } from './helpers/request-cost.helper';
import { KubernetesUsageSample } from './entities/kubernetes-usage-sample.entity';
import { KubernetesWorkload } from './entities/kubernetes-workload.entity';
import { KubernetesWorkloadUsageDaily } from './entities/kubernetes-workload-usage-daily.entity';
import { detectProvider } from './helpers/provider.helper';
import { ipsToResolve, resolveNodeInstanceIds } from './helpers/node-instance.helper';
import { AgentPrincipal } from './interfaces/kubernetes.interface';
import { containerSpecs } from './helpers/container-spec.helper';
import { boundClusterUid, CLUSTER_UID_MISMATCH } from './helpers/cluster-uid.helper';

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
    const clusterUid = boundClusterUid(cluster.clusterUid, report.clusterUid);
    if (clusterUid === CLUSTER_UID_MISMATCH) {
      this.logger.warn({ msg: 'Kubernetes report from another cluster rejected', clusterId: cluster.id, organizationId: agent.organizationId });
      throw new ConflictException('Agent token belongs to another cluster: generate a new install manifest for this cluster');
    }
    const firstConnection = cluster.connectedAt === null;
    const podCount = report.nodes.reduce((s, n) => s + n.podCount, 0);
    const instanceIds = await this.resolveInstanceIds(agent, report.nodes);

    await this.clusters.manager.transaction(async (manager) => {
      await manager.update(KubernetesCluster, { id: cluster.id }, {
        status: KubernetesClusterStatus.CONNECTED,
        provider: detectProvider(report.nodes),
        installMethod: report.installMethod,
        clusterUid,
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
      await this.upsertNodes(manager, agent, report.nodes, instanceIds, seenAt);
      await this.upsertWorkloads(manager, agent, report, seenAt);
      await manager.delete(KubernetesNode, { clusterId: cluster.id, lastSeenAt: LessThan(seenAt) });
      await manager.delete(KubernetesWorkload, { clusterId: cluster.id, lastSeenAt: LessThan(seenAt) });
      await this.insertSamples(manager, agent, report.nodes, instanceIds, seenAt);
      await this.upsertWorkloadUsage(manager, agent, report, seenAt);
      await this.upsertRequestUsage(manager, agent, report);
    });

    const linkedInstances = await this.linkInstances(agent, cluster.name, report.nodes, instanceIds);

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
      routes: report.requests?.routes.length ?? 0,
      droppedTraces: report.requests?.droppedTraces ?? 0,
    });
    return { accepted: true, nodes: report.nodes.length, workloads: report.workloads.length, linkedInstances };
  }

  private async resolveInstanceIds(agent: AgentPrincipal, nodes: ReportNodeDto[]): Promise<Map<string, string | null>> {
    const resources = await this.inventory.findEc2ByPrivateIps(agent.organizationId, ipsToResolve(nodes));
    const byIp = resources.flatMap((r) => {
      const privateIp = r.metadata?.ec2?.privateIpAddress;
      return privateIp ? [{ instanceId: r.resourceId, privateIp }] : [];
    });
    const resolved = resolveNodeInstanceIds(nodes, byIp);
    const viaIp = nodes.filter((n) => !n.providerId && resolved.get(n.name)).length;
    if (viaIp) this.logger.log({ msg: 'Kubernetes nodes linked by private IP', clusterId: agent.clusterId, nodes: viaIp });
    return resolved;
  }

  private async upsertNodes(manager: EntityManager, agent: AgentPrincipal, nodes: ReportNodeDto[], instanceIds: Map<string, string | null>, seenAt: Date): Promise<void> {
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
            instanceId: instanceIds.get(n.name) ?? null,
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
            containers: w.containers ? containerSpecs(w.containers) : null,
            lastSeenAt: seenAt,
          })),
        )
        .orUpdate(
          ['desiredReplicas', 'podCount', 'requestsCpu', 'requestsMemoryBytes', 'limitsCpu', 'limitsMemoryBytes', 'usageCpu', 'usageMemoryBytes', 'hpa', 'containers', 'lastSeenAt'],
          ['clusterId', 'namespace', 'kind', 'name'],
        )
        .execute();
    }
  }

  private async insertSamples(manager: EntityManager, agent: AgentPrincipal, nodes: ReportNodeDto[], instanceIds: Map<string, string | null>, seenAt: Date): Promise<void> {
    const rows = nodes
      .filter((n) => n.usage || n.filesystem)
      .map((n) => ({
        organizationId: agent.organizationId,
        clusterId: agent.clusterId,
        nodeName: n.name,
        instanceId: instanceIds.get(n.name) ?? null,
        cpuCores: n.usage?.cpuCores ?? null,
        memoryBytes: n.usage?.memoryBytes ?? null,
        requestsCpu: n.requests.cpuCores ?? null,
        requestsMemoryBytes: n.requests.memoryBytes ?? null,
        allocatableMemoryBytes: n.allocatable.memoryBytes ?? null,
        fsUsedBytes: n.filesystem?.usedBytes ?? null,
        fsCapacityBytes: n.filesystem?.capacityBytes ?? null,
        sampledAt: seenAt,
      }));
    for (const batch of chunk(rows, INGEST_BATCH_SIZE)) await manager.insert(KubernetesUsageSample, batch);
  }

  private async upsertWorkloadUsage(manager: EntityManager, agent: AgentPrincipal, report: AgentReportDto, seenAt: Date): Promise<void> {
    const day = toIsoDate(seenAt);
    const rows = report.workloads
      .filter((w) => w.usage && w.podCount > 0)
      .map((w) => {
        const cpu = w.usage?.cpuCores ?? null;
        const memory = w.usage?.memoryBytes ?? null;
        return {
          organizationId: agent.organizationId,
          clusterId: agent.clusterId,
          namespace: w.namespace,
          kind: w.kind,
          name: w.name,
          day,
          maxCpuPerPod: cpu === null ? null : cpu / w.podCount,
          maxMemoryPerPodBytes: memory === null ? null : Math.round(memory / w.podCount),
          samples: 1,
        };
      });
    const table = 'kubernetes_workload_usage_daily';
    for (const batch of chunk(rows, INGEST_BATCH_SIZE)) {
      await manager
        .createQueryBuilder()
        .insert()
        .into(KubernetesWorkloadUsageDaily)
        .values(batch)
        .onConflict(
          `("clusterId", "namespace", "kind", "name", "day") DO UPDATE SET "maxCpuPerPod" = GREATEST(${table}."maxCpuPerPod", EXCLUDED."maxCpuPerPod"), "maxMemoryPerPodBytes" = GREATEST(${table}."maxMemoryPerPodBytes", EXCLUDED."maxMemoryPerPodBytes"), "samples" = ${table}."samples" + 1`,
        )
        .execute();
    }
    const containerRows = report.workloads.flatMap((w) =>
      (w.containers ?? [])
        .filter((c) => c.usage)
        .map((c) => ({
          organizationId: agent.organizationId,
          clusterId: agent.clusterId,
          namespace: w.namespace,
          kind: w.kind,
          name: w.name,
          container: c.name,
          day,
          maxCpuCores: c.usage?.cpuCores ?? null,
          maxMemoryBytes: c.usage?.memoryBytes ?? null,
          samples: 1,
        })),
    );
    const containerTable = 'kubernetes_container_usage_daily';
    for (const batch of chunk(containerRows, INGEST_BATCH_SIZE)) {
      await manager
        .createQueryBuilder()
        .insert()
        .into(KubernetesContainerUsageDaily)
        .values(batch)
        .onConflict(
          `("clusterId", "namespace", "kind", "name", "container", "day") DO UPDATE SET "maxCpuCores" = GREATEST(${containerTable}."maxCpuCores", EXCLUDED."maxCpuCores"), "maxMemoryBytes" = GREATEST(${containerTable}."maxMemoryBytes", EXCLUDED."maxMemoryBytes"), "samples" = ${containerTable}."samples" + 1`,
        )
        .execute();
    }
  }

  private async upsertRequestUsage(manager: EntityManager, agent: AgentPrincipal, report: AgentReportDto): Promise<void> {
    if (!report.requests) return;
    const { routes, hops } = requestUsageRows(report.requests);
    const owner = { organizationId: agent.organizationId, clusterId: agent.clusterId };
    const routeTable = 'kubernetes_route_usage_hourly';
    for (const batch of chunk(routes, INGEST_BATCH_SIZE)) {
      await manager
        .createQueryBuilder()
        .insert()
        .into(KubernetesRouteUsageHourly)
        .values(batch.map((r) => ({ ...owner, ...r })))
        .onConflict(
          `("clusterId", "hour", "entryService", "entryRoute") DO UPDATE SET "requests" = ${routeTable}."requests" + EXCLUDED."requests", "durationMs" = ${routeTable}."durationMs" + EXCLUDED."durationMs"`,
        )
        .execute();
    }
    const hopTable = 'kubernetes_route_hop_usage_hourly';
    for (const batch of chunk(hops, INGEST_BATCH_SIZE)) {
      await manager
        .createQueryBuilder()
        .insert()
        .into(KubernetesRouteHopUsageHourly)
        .values(batch.map((h) => ({ ...owner, ...h })))
        .onConflict(
          `("clusterId", "hour", "entryService", "entryRoute", "hopKind", "namespace", "workloadKind", "workloadName", "service", "target") DO UPDATE SET "spans" = ${hopTable}."spans" + EXCLUDED."spans", "durationMs" = ${hopTable}."durationMs" + EXCLUDED."durationMs"`,
        )
        .execute();
    }
  }

  private async linkInstances(agent: AgentPrincipal, clusterName: string, nodes: ReportNodeDto[], instanceIds: Map<string, string | null>): Promise<number> {
    const byInstance = new Map(
      nodes.flatMap((n) => {
        const id = instanceIds.get(n.name);
        return id ? [[id, n] as const] : [];
      }),
    );
    const resources = await this.inventory.findEc2ByInstanceIds(agent.organizationId, [...byInstance.keys()]);
    for (const r of resources) {
      const n = byInstance.get(r.resourceId);
      if (!n) continue;
      await this.inventory.patchMetadata(r.awsAccountId, r.resourceType, r.resourceId, {
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
