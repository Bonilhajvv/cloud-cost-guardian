import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { In, Not, Repository } from 'typeorm';
import { AwsIntegrationError, toAwsIntegrationError } from '../aws/core/errors/aws-integration.error';
import { EksService } from '../aws/eks/eks.service';
import { EksClusterAccess } from '../aws/eks/interfaces/eks.interface';
import { AwsAccountsService } from '../aws-accounts/aws-accounts.service';
import { AwsAccountStatus, KubernetesClusterStatus, KubernetesConnectionMode, OrganizationStatus } from '../common/enums';
import { TenantUser } from '../common/interfaces/request-user.interface';
import { AdvisoryLockService } from '../database/advisory-lock.service';
import { EKS_ACCESS_GROUP, EKS_AGENT_VERSION, eksCollectLockKey } from './constants/eks-connection.constant';
import { AgentReportDto } from './dto/agent-report.dto';
import { CreateEksConnectionDto, EksCollectResultDto, EksConnectionDto } from './dto/eks-connection.dto';
import { KubernetesCluster } from './entities/kubernetes-cluster.entity';
import { aggregateSnapshot } from './helpers/aggregate-snapshot.helper';
import { renderEksRbac } from './helpers/manifest.helper';
import { KubeMeta, KubeNode, KubeNodeMetrics, KubePod, KubePodMetrics, KubeHpa, KubeScalable } from './interfaces/kube-objects.interface';
import { KubernetesClustersService } from './kubernetes-clusters.service';
import { KubernetesIngestService } from './kubernetes-ingest.service';

@Injectable()
export class EksConnectionsService {
  private readonly logger = new Logger(EksConnectionsService.name);

  constructor(
    @InjectRepository(KubernetesCluster) private readonly repo: Repository<KubernetesCluster>,
    private readonly clusters: KubernetesClustersService,
    private readonly accounts: AwsAccountsService,
    private readonly eks: EksService,
    private readonly ingest: KubernetesIngestService,
    private readonly locks: AdvisoryLockService,
  ) {}

  async create(user: TenantUser, dto: CreateEksConnectionDto): Promise<EksConnectionDto> {
    const account = await this.accounts.findConnected(user.organizationId, dto.awsAccountId);
    if (await this.repo.existsBy({ organizationId: user.organizationId, name: dto.name })) {
      throw new ConflictException('A cluster with this name already exists');
    }
    const cluster = await this.repo.save(
      this.repo.create({
        organizationId: user.organizationId,
        name: dto.name,
        awsAccountId: account.id,
        connectionMode: KubernetesConnectionMode.EKS_API,
        eksClusterName: dto.eksClusterName,
        eksRegion: dto.eksRegion,
      }),
    );
    this.logger.log({ msg: 'EKS connection registered', organizationId: user.organizationId, clusterId: cluster.id });
    return this.setup(cluster, account.roleArn ?? '');
  }

  async testConnection(user: TenantUser, id: string): Promise<EksCollectResultDto> {
    const cluster = await this.clusters.get(user.organizationId, id);
    if (cluster.connectionMode !== KubernetesConnectionMode.EKS_API) throw new ConflictException('This cluster is connected by the agent');
    return this.collect(cluster);
  }

  async collectAll(): Promise<{ collected: number; failed: number }> {
    const clusters = await this.repo.find({
      where: {
        connectionMode: KubernetesConnectionMode.EKS_API,
        status: Not(KubernetesClusterStatus.REVOKED),
        organization: { status: OrganizationStatus.ACTIVE },
        awsAccount: { status: In([AwsAccountStatus.CONNECTED, AwsAccountStatus.ERROR]) },
      },
    });
    const stats = { collected: 0, failed: 0 };
    for (const cluster of clusters) {
      if ((await this.collect(cluster)).success) stats.collected++;
      else stats.failed++;
    }
    return stats;
  }

  private async collect(cluster: KubernetesCluster): Promise<EksCollectResultDto> {
    try {
      const locked = await this.locks.tryWithLock(eksCollectLockKey(cluster.id), () => this.collectLocked(cluster));
      return locked.acquired ? { success: true, ...locked.value, error: null } : { success: false, nodes: 0, workloads: 0, error: 'A collection is already running' };
    } catch (error) {
      const err = toAwsIntegrationError(error);
      await this.repo.update({ id: cluster.id }, { lastError: err.message.slice(0, 2000) });
      this.logger.warn({ msg: 'EKS collection failed', clusterId: cluster.id, organizationId: cluster.organizationId, code: err.code, error: err.message });
      return { success: false, nodes: 0, workloads: 0, error: `${err.code}: ${err.message}` };
    }
  }

  private async collectLocked(cluster: KubernetesCluster): Promise<{ nodes: number; workloads: number }> {
    if (!cluster.awsAccountId || !cluster.eksClusterName || !cluster.eksRegion) throw new AwsIntegrationError('INVALID_CONFIGURATION', 'EKS connection is incomplete');
    const account = await this.accounts.findConnected(cluster.organizationId, cluster.awsAccountId);
    const access = await this.eks.describe(account, cluster.eksRegion, cluster.eksClusterName);
    const report = plainToInstance(AgentReportDto, await this.read(access));
    const errors = await validate(report, { whitelist: true });
    if (errors.length) throw new AwsIntegrationError('UNKNOWN', `Kubernetes API returned unexpected data (${errors.map((e) => e.property).join(', ')})`);
    const result = await this.ingest.ingest({ clusterId: cluster.id, organizationId: cluster.organizationId }, report);
    await this.repo.update({ id: cluster.id }, { lastError: null });
    return { nodes: result.nodes, workloads: result.workloads };
  }

  private async read(access: EksClusterAccess): Promise<object> {
    const required = async <T>(path: string): Promise<T[]> => {
      const items = await this.eks.list<T>(access, path);
      if (items === null) throw new AwsIntegrationError('DATA_UNAVAILABLE', `Kubernetes API has no ${path}`);
      return items;
    };
    const optional = async <T>(path: string): Promise<T[] | null> => {
      try {
        return await this.eks.list<T>(access, path);
      } catch (error) {
        const err = toAwsIntegrationError(error);
        this.logger.warn({ msg: 'Optional Kubernetes resource unavailable', eksCluster: access.clusterName, path, code: err.code });
        return null;
      }
    };
    const version = await this.eks.get<{ gitVersion?: string }>(access, '/version');
    const kubeSystem = await this.eks.get<{ metadata?: KubeMeta }>(access, '/api/v1/namespaces/kube-system');
    const nodes = await required<KubeNode>('/api/v1/nodes');
    const pods = await required<KubePod>('/api/v1/pods');
    const nodeMetrics = await optional<KubeNodeMetrics>('/apis/metrics.k8s.io/v1beta1/nodes');
    const { nodes: reportNodes, workloads } = aggregateSnapshot({
      nodes,
      pods,
      replicaSets: await required<KubeScalable>('/apis/apps/v1/replicasets'),
      deployments: (await optional<KubeScalable>('/apis/apps/v1/deployments')) ?? [],
      statefulSets: (await optional<KubeScalable>('/apis/apps/v1/statefulsets')) ?? [],
      daemonSets: (await optional<KubeScalable>('/apis/apps/v1/daemonsets')) ?? [],
      hpas: (await optional<KubeHpa>('/apis/autoscaling/v2/horizontalpodautoscalers')) ?? [],
      nodeMetrics,
      podMetrics: nodeMetrics ? await optional<KubePodMetrics>('/apis/metrics.k8s.io/v1beta1/pods') : null,
    });
    return {
      agentVersion: EKS_AGENT_VERSION,
      installMethod: 'unknown',
      clusterUid: kubeSystem?.metadata?.uid,
      kubernetesVersion: version?.gitVersion ?? 'unknown',
      metricsServerAvailable: nodeMetrics !== null,
      collectedAt: new Date().toISOString(),
      nodes: reportNodes,
      workloads,
    };
  }

  private setup(cluster: KubernetesCluster, roleArn: string): EksConnectionDto {
    return {
      clusterId: cluster.id,
      roleArn,
      accessEntryCommand: `aws eks create-access-entry --cluster-name ${cluster.eksClusterName} --region ${cluster.eksRegion} --principal-arn ${roleArn} --kubernetes-groups ${EKS_ACCESS_GROUP}`,
      rbacManifest: renderEksRbac(),
      steps: [
        'Update the CloudFormation stack or the IAM policy of the role so it allows eks:DescribeCluster',
        'Run accessEntryCommand with an identity that administers the EKS cluster',
        'Save rbacManifest to a file and run kubectl apply -f on it',
        'Run POST /kubernetes-clusters/:id/test-connection until it succeeds',
      ],
      limitations: [
        'The EKS endpoint must be public and reachable from Cloud Cost Guardian: use the agent for private endpoints',
        'The cluster authentication mode must accept access entries (API or API_AND_CONFIG_MAP)',
        'Pod specs, including plain-text environment variables, pass through the platform memory and are never stored: use the agent when that is not acceptable',
        'Node disk usage is not collected: only the agent reads it',
        'metrics-server is required for real CPU and memory usage',
      ],
    };
  }
}
