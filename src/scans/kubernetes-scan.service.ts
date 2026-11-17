import { Injectable, Logger } from '@nestjs/common';
import { isEc2Analysis } from '../aws/core/helpers/resource-analysis.helper';
import { EnvironmentInfo } from '../aws/core/interfaces/environment.interface';
import { ResourceAnalysis } from '../aws/core/interfaces/recommendation-draft.interface';
import { AwsAccount } from '../aws-accounts/entities/aws-account.entity';
import {
  CONTROL_PLANE_ROLE,
  K8S_ANALYSIS,
  MAX_RESOURCE_ID_LENGTH,
  RIGHTSIZABLE_KINDS,
} from '../kubernetes/constants/kubernetes-analysis.constant';
import { nodePoolOf } from '../kubernetes/helpers/kubernetes-analysis.helper';
import { clusterEnvironment, namespaceEnvironment, nodeGroupEnvironment } from '../kubernetes/helpers/kubernetes-environment.helper';
import { ClusterAnalysisData, KubernetesAnalyzerResult, NodeGroupMember, NodePool } from '../kubernetes/interfaces/kubernetes-analysis.interface';
import { KubernetesAnalyzerService } from '../kubernetes/kubernetes-analyzer.service';
import { KubernetesMetricsService } from '../kubernetes/kubernetes-metrics.service';
import { EffectiveWorkSchedule } from '../organizations/interfaces/work-schedule.interface';
import { OrganizationsService } from '../organizations/organizations.service';
import { KUBERNETES_RECOMMENDATION_TYPES } from '../recommendations/constants/recommendation.constant';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { DEFAULT_CURRENCY } from './constants/scan.constant';
import { AnalysisDetails } from './interfaces/scan-report.interface';

@Injectable()
export class KubernetesScanService {
  private readonly logger = new Logger(KubernetesScanService.name);

  constructor(
    private readonly metrics: KubernetesMetricsService,
    private readonly analyzer: KubernetesAnalyzerService,
    private readonly recommendations: RecommendationsService,
    private readonly organizations: OrganizationsService,
  ) {}

  async analyze(account: AwsAccount, ec2Analyses: ReadonlyMap<string, ResourceAnalysis>): Promise<Omit<AnalysisDetails, 'ebs' | 'rds' | 'network' | 'kubernetes' | 'schedule'>> {
    const clusters = await this.metrics.analysisData(account.organizationId, account.id, K8S_ANALYSIS.windowDays);
    const schedule = await this.organizations.workSchedule(account.organizationId);
    const results = clusters
      .flatMap((c) => [...this.workloads(c), ...this.nodeGroups(c, ec2Analyses, schedule), ...this.namespaces(c, schedule)])
      .filter((r) => r.analysis.resourceId.length <= MAX_RESOURCE_ID_LENGTH);
    const drafts = results.flatMap((r) => r.drafts);
    const analyses = new Map<string, ResourceAnalysis>(results.map((r) => [r.analysis.resourceId, r.analysis]));
    const findings: Record<string, number> = {};
    for (const r of results) findings[r.analysis.finding] = (findings[r.analysis.finding] ?? 0) + 1;
    const sync = await this.recommendations.syncDrafts(account, KUBERNETES_RECOMMENDATION_TYPES, drafts, analyses);
    this.logger.log({ msg: 'Kubernetes analysis finished', awsAccountRef: account.id, clusters: clusters.length, analyzed: results.length, findings, drafts: drafts.length });
    return { analyzed: results.length, findings, ...sync };
  }

  private workloads(data: ClusterAnalysisData): KubernetesAnalyzerResult[] {
    return data.workloads
      .filter(({ workload }) => RIGHTSIZABLE_KINDS.includes(workload.kind) && workload.podCount > 0)
      .map(({ workload, peak, containerPeaks }) =>
        this.analyzer.analyzeWorkload({
          clusterId: data.cluster.id,
          clusterName: data.cluster.name,
          workload,
          peak,
          containerPeaks,
          environment: namespaceEnvironment(data.cluster, workload.namespace),
          currency: DEFAULT_CURRENCY,
        }),
      );
  }

  private namespaces(data: ClusterAnalysisData, schedule: EffectiveWorkSchedule): KubernetesAnalyzerResult[] {
    if (clusterEnvironment(data.cluster).environment === 'NON_PRODUCTION') return [];
    const byNamespace = new Map<string, ClusterAnalysisData['workloads'][number]['workload'][]>();
    for (const { workload } of data.workloads) byNamespace.set(workload.namespace, [...(byNamespace.get(workload.namespace) ?? []), workload]);
    return [...byNamespace].map(([namespace, workloads]) =>
      this.analyzer.analyzeNamespace({
        clusterId: data.cluster.id,
        clusterName: data.cluster.name,
        namespace,
        workloads,
        environment: namespaceEnvironment(data.cluster, namespace),
        schedule,
        currency: DEFAULT_CURRENCY,
      }),
    );
  }

  private nodeGroups(data: ClusterAnalysisData, ec2Analyses: ReadonlyMap<string, ResourceAnalysis>, schedule: EffectiveWorkSchedule): KubernetesAnalyzerResult[] {
    const groups = new Map<string, { pool: NodePool | null; instanceType: string | null; nodes: NodeGroupMember[]; environments: (EnvironmentInfo | null)[] }>();
    for (const { node, peakRequests } of data.nodes) {
      if (node.role === CONTROL_PLANE_ROLE) continue;
      const pool = nodePoolOf(node.labels);
      const key = `${pool?.value ?? ''}|${node.instanceType ?? ''}`;
      const group = groups.get(key) ?? { pool, instanceType: node.instanceType, nodes: [], environments: [] };
      const ec2 = node.instanceId ? ec2Analyses.get(node.instanceId) : undefined;
      group.nodes.push({
        nodeName: node.nodeName,
        instanceId: node.instanceId,
        allocatableCpu: node.allocatableCpu,
        allocatableMemoryBytes: node.allocatableMemoryBytes,
        peakRequests,
        monthlyCost: ec2?.current.monthlyCost ?? null,
      });
      group.environments.push(ec2 && isEc2Analysis(ec2) ? (ec2.environment ?? null) : null);
      groups.set(key, group);
    }
    return [...groups.values()].map(({ environments, ...g }) =>
      this.analyzer.analyzeNodeGroup({
        clusterId: data.cluster.id,
        clusterName: data.cluster.name,
        ...g,
        environment: nodeGroupEnvironment(data.cluster, g.pool, environments),
        schedule,
        currency: DEFAULT_CURRENCY,
      }),
    );
  }
}
