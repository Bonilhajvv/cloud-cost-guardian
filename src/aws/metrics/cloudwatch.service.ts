import {
  CloudWatchClient,
  Dimension,
  GetMetricDataCommand,
  paginateListMetrics,
} from '@aws-sdk/client-cloudwatch';
import { Injectable, Logger } from '@nestjs/common';
import { chunk } from '../../common/helpers/stats.helper';
import { AwsClientFactory } from '../core/aws-client.factory';
import { toAwsIntegrationError } from '../core/errors/aws-integration.error';
import { AwsAccountRef } from '../core/interfaces/aws-account-ref.interface';
import { isBurstable } from '../ec2/helpers/burstable.helper';
import {
  CONTAINER_INSIGHTS_NAMESPACE,
  CW_AGENT_NAMESPACE,
  DAY,
  HOUR,
  MAX_QUERIES_PER_CALL,
  RECENTLY_ACTIVE,
} from './constants/cloudwatch.constant';
import { buildDailyUsage } from './helpers/build-daily-usage.helper';
import { buildEbsUtilization } from './helpers/build-ebs-utilization.helper';
import { buildUtilization } from './helpers/build-utilization.helper';
import { EbsUtilizationMetrics, MetricQuerySpec, TimeSeries } from './interfaces/ebs-metrics.interface';
import { EbsQueryKind, QueryKind } from './interfaces/metric-query-kind.type';
import { Ec2UtilizationMetrics, MemorySource } from './interfaces/utilization-metrics.interface';

@Injectable()
export class CloudWatchService {
  private readonly logger = new Logger(CloudWatchService.name);

  constructor(private readonly clients: AwsClientFactory) {}

  async getEc2Utilization(
    account: AwsAccountRef,
    region: string,
    instances: readonly { instanceId: string; instanceType: string }[],
    periodDays = 14,
  ): Promise<Map<string, Ec2UtilizationMetrics>> {
    const result = new Map<string, Ec2UtilizationMetrics>();
    if (instances.length === 0) return result;

    const client = await this.clients.createClient(CloudWatchClient, account, region);
    const ids = new Set(instances.map((i) => i.instanceId));
    const agentMemory = await this.findDimensions(client, CW_AGENT_NAMESPACE, 'mem_used_percent', ids);
    const insightsMemory = await this.findDimensions(client, CONTAINER_INSIGHTS_NAMESPACE, 'node_memory_utilization', ids);
    const agentDisk = await this.findDimensions(client, CW_AGENT_NAMESPACE, 'disk_used_percent', ids);

    const specs: MetricQuerySpec<QueryKind>[] = [];
    const memorySource = new Map<string, MemorySource>();
    for (const { instanceId, instanceType } of instances) {
      const dims = [{ Name: 'InstanceId', Value: instanceId }];
      const ec2 = (kind: QueryKind, metricName: string, stat: string, period: number) =>
        specs.push({ ownerId: instanceId, kind, namespace: 'AWS/EC2', metricName, dimensions: dims, stat, period });
      ec2('cpuAvg', 'CPUUtilization', 'Average', HOUR);
      ec2('cpuMax', 'CPUUtilization', 'Maximum', HOUR);
      ec2('netIn', 'NetworkIn', 'Sum', DAY);
      ec2('netOut', 'NetworkOut', 'Sum', DAY);
      if (isBurstable(instanceType)) {
        ec2('creditMin', 'CPUCreditBalance', 'Minimum', HOUR);
        ec2('surplus', 'CPUSurplusCreditsCharged', 'Sum', DAY);
      }
      const agentMem = agentMemory.get(instanceId)?.[0];
      const insightsMem = insightsMemory.get(instanceId)?.[0];
      if (agentMem) {
        memorySource.set(instanceId, 'CLOUDWATCH_AGENT');
        specs.push({ ownerId: instanceId, kind: 'mem', namespace: CW_AGENT_NAMESPACE, metricName: 'mem_used_percent', dimensions: toDims(agentMem), stat: 'Average', period: HOUR });
      } else if (insightsMem) {
        memorySource.set(instanceId, 'CONTAINER_INSIGHTS');
        specs.push({ ownerId: instanceId, kind: 'mem', namespace: CONTAINER_INSIGHTS_NAMESPACE, metricName: 'node_memory_utilization', dimensions: toDims(insightsMem), stat: 'Average', period: HOUR });
      }
      for (const diskDims of agentDisk.get(instanceId) ?? []) {
        specs.push({ ownerId: instanceId, kind: 'disk', namespace: CW_AGENT_NAMESPACE, metricName: 'disk_used_percent', dimensions: toDims(diskDims), stat: 'Maximum', period: HOUR });
      }
    }

    const end = new Date();
    const series = await this.fetch(client, specs, new Date(end.getTime() - periodDays * DAY * 1000), end, region);
    const grouped = new Map<string, Partial<Record<QueryKind, number[]>>>();
    const raw = new Map<string, Partial<Record<QueryKind, TimeSeries>>>();
    series.forEach((s, i) => {
      const { ownerId, kind } = specs[i];
      const g = grouped.get(ownerId) ?? {};
      g[kind] = [...(g[kind] ?? []), ...s.values];
      grouped.set(ownerId, g);
      const r = raw.get(ownerId) ?? {};
      r[kind] = r[kind] ?? s;
      raw.set(ownerId, r);
    });
    for (const [instanceId, g] of grouped) {
      const r = raw.get(instanceId) ?? {};
      result.set(
        instanceId,
        buildUtilization(g, periodDays, end, memorySource.get(instanceId), {
          cpu: buildDailyUsage(r.cpuAvg, r.cpuMax),
          memory: r.mem ? buildDailyUsage(r.mem) : [],
        }),
      );
    }
    this.logger.log({
      msg: 'EC2 utilization collected',
      region,
      instances: instances.length,
      memoryAgent: [...memorySource.values()].filter((s) => s === 'CLOUDWATCH_AGENT').length,
      memoryContainerInsights: [...memorySource.values()].filter((s) => s === 'CONTAINER_INSIGHTS').length,
      diskAgent: agentDisk.size,
    });
    return result;
  }

  async getEbsUtilization(
    account: AwsAccountRef,
    region: string,
    volumeIds: readonly string[],
    periodDays = 14,
  ): Promise<Map<string, EbsUtilizationMetrics>> {
    const result = new Map<string, EbsUtilizationMetrics>();
    if (volumeIds.length === 0) return result;
    const client = await this.clients.createClient(CloudWatchClient, account, region);

    const specs: MetricQuerySpec<EbsQueryKind>[] = [];
    for (const volumeId of volumeIds) {
      const dims = [{ Name: 'VolumeId', Value: volumeId }];
      const ebs = (kind: EbsQueryKind, metricName: string, stat: string) =>
        specs.push({ ownerId: volumeId, kind, namespace: 'AWS/EBS', metricName, dimensions: dims, stat, period: HOUR });
      ebs('readOps', 'VolumeReadOps', 'Sum');
      ebs('writeOps', 'VolumeWriteOps', 'Sum');
      ebs('readBytes', 'VolumeReadBytes', 'Sum');
      ebs('writeBytes', 'VolumeWriteBytes', 'Sum');
      ebs('burstBalance', 'BurstBalance', 'Minimum');
    }

    const end = new Date();
    const series = await this.fetch(client, specs, new Date(end.getTime() - periodDays * DAY * 1000), end, region);
    const grouped = new Map<string, Partial<Record<EbsQueryKind, TimeSeries>>>();
    series.forEach((s, i) => {
      const { ownerId, kind } = specs[i];
      const g = grouped.get(ownerId) ?? {};
      g[kind] = s;
      grouped.set(ownerId, g);
    });
    for (const [volumeId, g] of grouped) result.set(volumeId, buildEbsUtilization(g, periodDays, end));
    this.logger.log({ msg: 'EBS utilization collected', region, volumes: volumeIds.length });
    return result;
  }

  private async fetch<K extends string>(
    client: CloudWatchClient,
    specs: MetricQuerySpec<K>[],
    start: Date,
    end: Date,
    region: string,
  ): Promise<TimeSeries[]> {
    const out: TimeSeries[] = specs.map(() => ({ timestamps: [], values: [] }));
    const indexed = specs.map((spec, index) => ({ spec, index }));
    try {
      for (const batch of chunk(indexed, MAX_QUERIES_PER_CALL)) {
        let NextToken: string | undefined;
        do {
          const page = await client.send(
            new GetMetricDataCommand({
              MetricDataQueries: batch.map(({ spec, index }) => ({
                Id: `q${index}`,
                MetricStat: {
                  Metric: { Namespace: spec.namespace, MetricName: spec.metricName, Dimensions: spec.dimensions },
                  Period: spec.period,
                  Stat: spec.stat,
                },
                ReturnData: true,
              })),
              StartTime: start,
              EndTime: end,
              ScanBy: 'TimestampAscending',
              NextToken,
            }),
          );
          for (const r of page.MetricDataResults ?? []) {
            const index = Number(r.Id?.slice(1));
            if (!Number.isInteger(index) || !out[index]) continue;
            out[index].timestamps.push(...(r.Timestamps ?? []).map((t) => t.getTime()));
            out[index].values.push(...(r.Values ?? []));
          }
          NextToken = page.NextToken;
        } while (NextToken);
      }
    } catch (error) {
      throw toAwsIntegrationError(error, `GetMetricData ${region}`);
    }
    return out;
  }

  private async findDimensions(
    client: CloudWatchClient,
    namespace: string,
    metricName: string,
    instanceIds: Set<string>,
  ): Promise<Map<string, Dimension[][]>> {
    const out = new Map<string, Dimension[][]>();
    try {
      for await (const page of paginateListMetrics(
        { client },
        { Namespace: namespace, MetricName: metricName, RecentlyActive: RECENTLY_ACTIVE },
      )) {
        for (const m of page.Metrics ?? []) {
          const id = m.Dimensions?.find((d) => d.Name === 'InstanceId')?.Value;
          if (id && instanceIds.has(id)) out.set(id, [...(out.get(id) ?? []), m.Dimensions ?? []]);
        }
      }
    } catch (error) {
      const err = toAwsIntegrationError(error, `ListMetrics ${namespace}/${metricName}`);
      if (err.code !== 'ACCESS_DENIED') throw err;
    }
    return out;
  }
}

function toDims(dims: Dimension[]): { Name: string; Value: string }[] {
  return dims
    .filter((d): d is Dimension & { Name: string; Value: string } => !!d.Name && d.Value !== undefined)
    .map((d) => ({ Name: d.Name, Value: d.Value }));
}
