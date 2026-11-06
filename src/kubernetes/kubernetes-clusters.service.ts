import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AwsAccountsService } from '../aws-accounts/aws-accounts.service';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { AuditAction, KubernetesClusterStatus } from '../common/enums';
import { paginate } from '../common/helpers/paginate.helper';
import { round } from '../common/helpers/stats.helper';
import { Paginated } from '../common/interfaces/paginated.interface';
import { TenantUser } from '../common/interfaces/request-user.interface';
import { EnvironmentVariables } from '../config/env.validation';
import { ResourceInventoryService } from '../resource-inventory/resource-inventory.service';
import { AGENT_NAMESPACE, INSTALL_MANIFEST_PATH, INSTALL_TOKEN_TTL_MS } from './constants/kubernetes.constant';
import { ClusterInstallDto } from './dto/cluster-install.dto';
import { CreateClusterDto } from './dto/create-cluster.dto';
import { KubernetesCluster } from './entities/kubernetes-cluster.entity';
import { KubernetesNode } from './entities/kubernetes-node.entity';
import { KubernetesWorkload } from './entities/kubernetes-workload.entity';
import { renderAgentManifest, renderHelmValues } from './helpers/manifest.helper';
import { generateInstallToken, parseAgentToken, sha256, signAgentToken } from './helpers/tokens.helper';
import { AgentPrincipal, ClusterSuggestion, ManifestParams } from './interfaces/kubernetes.interface';

@Injectable()
export class KubernetesClustersService {
  private readonly logger = new Logger(KubernetesClustersService.name);

  constructor(
    @InjectRepository(KubernetesCluster) private readonly clusters: Repository<KubernetesCluster>,
    @InjectRepository(KubernetesNode) private readonly nodes: Repository<KubernetesNode>,
    @InjectRepository(KubernetesWorkload) private readonly workloads: Repository<KubernetesWorkload>,
    private readonly accounts: AwsAccountsService,
    private readonly inventory: ResourceInventoryService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async create(user: TenantUser, dto: CreateClusterDto): Promise<ClusterInstallDto> {
    if (dto.awsAccountId) await this.accounts.get(user.organizationId, dto.awsAccountId);
    if (await this.clusters.existsBy({ organizationId: user.organizationId, name: dto.name })) {
      throw new ConflictException('A cluster with this name already exists');
    }
    const cluster = await this.clusters.save(
      this.clusters.create({ organizationId: user.organizationId, name: dto.name, awsAccountId: dto.awsAccountId ?? null }),
    );
    this.logger.log({ msg: 'Kubernetes cluster registered', organizationId: user.organizationId, clusterId: cluster.id });
    return this.issueInstall(cluster);
  }

  async regenerateInstall(user: TenantUser, id: string): Promise<ClusterInstallDto> {
    const cluster = await this.get(user.organizationId, id);
    if (cluster.status === KubernetesClusterStatus.REVOKED) {
      cluster.status = KubernetesClusterStatus.PENDING;
      cluster.agentTokenVersion += 1;
    }
    return this.issueInstall(cluster);
  }

  list(organizationId: string): Promise<KubernetesCluster[]> {
    return this.clusters.find({ where: { organizationId }, order: { createdAt: 'DESC' } });
  }

  async get(organizationId: string, id: string): Promise<KubernetesCluster> {
    const cluster = await this.clusters.findOneBy({ id, organizationId });
    if (!cluster) throw new NotFoundException('Kubernetes cluster not found');
    return cluster;
  }

  async listNodes(organizationId: string, id: string): Promise<KubernetesNode[]> {
    await this.get(organizationId, id);
    return this.nodes.find({ where: { clusterId: id, organizationId }, order: { nodeName: 'ASC' } });
  }

  async listWorkloads(organizationId: string, id: string, query: PaginationQueryDto): Promise<Paginated<KubernetesWorkload>> {
    await this.get(organizationId, id);
    const [items, total] = await this.workloads.findAndCount({
      where: { clusterId: id, organizationId },
      order: { requestsMemoryBytes: { direction: 'DESC', nulls: 'LAST' } },
      skip: query.skip,
      take: query.limit,
    });
    return paginate(items, total, query);
  }

  async revoke(user: TenantUser, id: string): Promise<void> {
    const cluster = await this.get(user.organizationId, id);
    await this.clusters.update(
      { id: cluster.id },
      {
        status: KubernetesClusterStatus.REVOKED,
        agentTokenVersion: cluster.agentTokenVersion + 1,
        installTokenHash: null,
        installTokenExpiresAt: null,
      },
    );
    await this.audit.log({
      action: AuditAction.KUBERNETES_REVOKED,
      organizationId: user.organizationId,
      userId: user.userId,
      targetType: 'KubernetesCluster',
      targetId: cluster.id,
    });
    this.logger.warn({ msg: 'Kubernetes agent revoked', organizationId: user.organizationId, clusterId: cluster.id });
  }

  async suggestions(organizationId: string): Promise<ClusterSuggestion[]> {
    const [candidates, connected] = await Promise.all([
      this.inventory.findKubernetesNodeCandidates(organizationId),
      this.nodes.find({ where: { organizationId }, select: { instanceId: true } }),
    ]);
    const known = new Set(connected.map((n) => n.instanceId).filter((id): id is string => !!id));
    const groups = new Map<string, ClusterSuggestion>();
    for (const r of candidates) {
      if (known.has(r.resourceId)) continue;
      const analysis = r.metadata.analysis;
      if (!analysis || analysis.kind === 'EBS' || !analysis.kubernetes) continue;
      const key = `${r.awsAccountId}|${analysis.kubernetes.cluster ?? ''}`;
      const g = groups.get(key) ?? {
        awsAccountId: r.awsAccountId,
        clusterName: analysis.kubernetes.cluster,
        managedBy: analysis.kubernetes.managedBy,
        instanceIds: [],
        nodeNames: [],
        estimatedMonthlyCost: null,
      };
      g.instanceIds.push(r.resourceId);
      g.nodeNames.push(r.name ?? r.resourceId);
      const cost = analysis.current.monthlyCost;
      if (cost !== null) g.estimatedMonthlyCost = round((g.estimatedMonthlyCost ?? 0) + cost);
      groups.set(key, g);
    }
    return [...groups.values()];
  }

  async renderManifest(installToken: string, format: 'manifest' | 'helm-values'): Promise<string> {
    const cluster = await this.clusters
      .createQueryBuilder('c')
      .addSelect('c.installTokenHash')
      .where('c.installTokenHash = :hash', { hash: sha256(installToken) })
      .getOne();
    if (!cluster || !cluster.installTokenExpiresAt || cluster.installTokenExpiresAt.getTime() < Date.now()) {
      throw new NotFoundException('Install link expired or invalid: generate a new one in Cloud Cost Guardian');
    }
    const params: ManifestParams = {
      clusterId: cluster.id,
      clusterName: cluster.name,
      agentToken: signAgentToken(this.agentSecret(), cluster.id, cluster.agentTokenVersion),
      apiUrl: this.config.get('PUBLIC_API_URL', { infer: true }),
      image: this.config.get('K8S_AGENT_IMAGE', { infer: true }),
    };
    this.logger.log({ msg: 'Kubernetes install manifest served', clusterId: cluster.id, format });
    return format === 'manifest' ? renderAgentManifest(params) : renderHelmValues(params);
  }

  async verifyAgentToken(token: string): Promise<AgentPrincipal | null> {
    const parsed = parseAgentToken(this.agentSecret(), token);
    if (!parsed) return null;
    const cluster = await this.clusters.findOneBy({ id: parsed.clusterId });
    if (!cluster || cluster.status === KubernetesClusterStatus.REVOKED) return null;
    if (cluster.agentTokenVersion !== parsed.version) return null;
    return { clusterId: cluster.id, organizationId: cluster.organizationId };
  }

  private async issueInstall(cluster: KubernetesCluster): Promise<ClusterInstallDto> {
    const installToken = generateInstallToken();
    const expiresAt = new Date(Date.now() + INSTALL_TOKEN_TTL_MS);
    await this.clusters.update(
      { id: cluster.id },
      {
        installTokenHash: sha256(installToken),
        installTokenExpiresAt: expiresAt,
        status: cluster.status,
        agentTokenVersion: cluster.agentTokenVersion,
      },
    );
    const base = `${this.config.get('PUBLIC_API_URL', { infer: true })}${INSTALL_MANIFEST_PATH}/${installToken}`;
    const chart = this.config.get('K8S_AGENT_HELM_CHART', { infer: true });
    return {
      clusterId: cluster.id,
      installToken,
      expiresAt,
      manifestUrl: `${base}.yaml`,
      commands: {
        kubectl: `kubectl apply -f "${base}.yaml"`,
        helm: `helm install ccg-agent ${chart} --namespace ${AGENT_NAMESPACE} --create-namespace -f "${base}/values.yaml"`,
        uninstallKubectl: `kubectl delete namespace ${AGENT_NAMESPACE} && kubectl delete clusterrole,clusterrolebinding ccg-agent-readonly`,
        uninstallHelm: `helm uninstall ccg-agent --namespace ${AGENT_NAMESPACE}`,
      },
      requirements: [
        'kubectl access with permission to create a namespace, ClusterRole and ClusterRoleBinding',
        'Outbound HTTPS (443) from the cluster to the Cloud Cost Guardian API',
        'metrics-server installed for real CPU/memory usage (kubectl top nodes must work)',
      ],
    };
  }

  private agentSecret(): string {
    return this.config.get('AGENT_TOKEN_SECRET', { infer: true });
  }
}
