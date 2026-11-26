import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Not, Repository } from 'typeorm';
import { isEc2Analysis } from '../aws/core/helpers/resource-analysis.helper';
import { round } from '../common/helpers/stats.helper';
import { ResourceInventoryService } from '../resource-inventory/resource-inventory.service';
import { DEFAULT_CURRENCY } from '../scans/constants/scan.constant';
import { CONTROL_PLANE_ROLE } from './constants/kubernetes-analysis.constant';
import { MS_PER_HOUR, REQUEST_COST_DECIMALS, REQUEST_COST_DEFAULT_HOURS, REQUEST_COST_MAX_DAYS, REQUEST_COST_NOTES } from './constants/request-cost.constant';
import { RequestCostsQueryDto } from './dto/request-costs-query.dto';
import { KubernetesNode } from './entities/kubernetes-node.entity';
import { KubernetesRouteHopUsageHourly } from './entities/kubernetes-route-hop-usage-hourly.entity';
import { KubernetesRouteUsageHourly } from './entities/kubernetes-route-usage-hourly.entity';
import { KubernetesWorkload } from './entities/kubernetes-workload.entity';
import { allocateRouteCosts, clusterHourlyCost, startOfHour, workloadHourlyCosts } from './helpers/request-cost.helper';
import { CostNode, RequestCostReport } from './interfaces/request-cost.interface';
import { KubernetesClustersService } from './kubernetes-clusters.service';

@Injectable()
export class KubernetesRequestCostsService {
  constructor(
    @InjectRepository(KubernetesNode) private readonly nodes: Repository<KubernetesNode>,
    @InjectRepository(KubernetesWorkload) private readonly workloads: Repository<KubernetesWorkload>,
    @InjectRepository(KubernetesRouteUsageHourly) private readonly routes: Repository<KubernetesRouteUsageHourly>,
    @InjectRepository(KubernetesRouteHopUsageHourly) private readonly hops: Repository<KubernetesRouteHopUsageHourly>,
    private readonly clusters: KubernetesClustersService,
    private readonly inventory: ResourceInventoryService,
  ) {}

  async report(organizationId: string, clusterId: string, query: RequestCostsQueryDto): Promise<RequestCostReport> {
    await this.clusters.get(organizationId, clusterId);
    const { from, to } = this.window(query);
    const hours = Between(startOfHour(from), new Date(to.getTime() - 1));
    const [routes, hops, nodes, workloads] = await Promise.all([
      this.routes.find({ where: { organizationId, clusterId, hour: hours } }),
      this.hops.find({ where: { organizationId, clusterId, hour: hours } }),
      this.nodes.find({ where: { organizationId, clusterId, role: Not(CONTROL_PLANE_ROLE) } }),
      this.workloads.find({ where: { organizationId, clusterId } }),
    ]);
    const costNodes = await this.costNodes(organizationId, nodes);
    const hourly = clusterHourlyCost(costNodes);
    const unpriced = costNodes.filter((n) => n.monthlyCost === null).length;
    const notes: string[] = [REQUEST_COST_NOTES.workloadCost, REQUEST_COST_NOTES.routeSplit, REQUEST_COST_NOTES.externals, REQUEST_COST_NOTES.idle, REQUEST_COST_NOTES.sampling];
    if (unpriced > 0) notes.push(`${unpriced} worker node(s) have no known EC2 price, so costs are null: link the cluster to its AWS account and run a scan`);
    if (routes.length === 0) notes.push('No traces received in this window: send OTLP traces to the agent (port 4318) or enable Beyla in the Helm chart');
    return {
      clusterId,
      from: from.toISOString(),
      to: to.toISOString(),
      currency: DEFAULT_CURRENCY,
      clusterHourlyCost: hourly === null ? null : round(hourly, REQUEST_COST_DECIMALS),
      routes: allocateRouteCosts(routes, hops, workloadHourlyCosts(costNodes, workloads)),
      notes,
    };
  }

  private window(query: RequestCostsQueryDto): { from: Date; to: Date } {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - REQUEST_COST_DEFAULT_HOURS * MS_PER_HOUR);
    if (from >= to) throw new BadRequestException('from must be before to');
    if (to.getTime() - from.getTime() > REQUEST_COST_MAX_DAYS * 24 * MS_PER_HOUR) throw new BadRequestException(`The window can be at most ${REQUEST_COST_MAX_DAYS} days`);
    return { from, to };
  }

  private async costNodes(organizationId: string, nodes: KubernetesNode[]): Promise<CostNode[]> {
    const ids = nodes.map((n) => n.instanceId).filter((id): id is string => !!id);
    const resources = await this.inventory.findEc2ByInstanceIds(organizationId, ids);
    const monthly = new Map(
      resources.map((r) => {
        const analysis = r.metadata.analysis;
        return [r.resourceId, analysis && isEc2Analysis(analysis) ? analysis.current.monthlyCost : null] as const;
      }),
    );
    return nodes.map((n) => ({
      monthlyCost: n.instanceId ? (monthly.get(n.instanceId) ?? null) : null,
      allocatableCpu: n.allocatableCpu,
      allocatableMemoryBytes: n.allocatableMemoryBytes,
    }));
  }
}
