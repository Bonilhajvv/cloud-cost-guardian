import { Injectable } from '@nestjs/common';
import { Level, RecommendationType } from '../../common/enums';
import { round } from '../../common/helpers/stats.helper';
import { detectEnvironment } from '../core/helpers/environment.helper';
import { buildServiceAnalysis } from '../core/helpers/service-analysis.helper';
import { ServiceAnalysisResult, ServiceOpportunity } from '../core/interfaces/service-analysis.interface';
import { AuroraModePrices } from '../pricing/interfaces/aurora-price.interface';
import { HOURS_PER_MONTH } from '../pricing/constants/pricing.constant';
import {
  AURORA_FLOOR_MIN_RATIO,
  AURORA_FLOOR_TOLERANCE,
  AURORA_LOWEST_CAPACITY,
  AURORA_MODE_MIN_RATIO,
  AURORA_MODE_MIN_SAVINGS,
  AURORA_SERVERLESS_CLASS,
  IDLE_MIN_DATAPOINTS,
} from './constants/rds.constant';
import { AuroraAnalyzerInput, AuroraMember } from './interfaces/aurora.interface';

@Injectable()
export class AuroraAnalyzerService {
  analyze(input: AuroraAnalyzerInput): ServiceAnalysisResult {
    const { cluster, usage, currency } = input;
    const now = input.now ?? new Date();
    const instancesCost = this.instancesCost(input, this.mode(input));
    const storageIoCost = this.storageIoCost(input, cluster.ioOptimized);
    const monthlyCost = instancesCost === null ? null : round(instancesCost + (storageIoCost ?? 0));
    const notes: string[] = [];
    if (instancesCost === null) notes.push('Instance price or usage unavailable');
    if (storageIoCost === null) notes.push('Storage and I/O cost unavailable');
    notes.push('Costs estimated from on-demand prices (RI discounts and backups not included)');
    const base = {
      kind: 'AURORA' as const,
      resourceId: cluster.arn,
      resourceArn: cluster.arn,
      name: cluster.clusterId,
      region: cluster.region,
      environment: detectEnvironment(cluster.clusterId, cluster.tags, input.environmentOverride ?? null),
      current: {
        monthlyCost,
        details: {
          engine: cluster.engine,
          engineVersion: cluster.engineVersion,
          storageMode: cluster.ioOptimized ? 'IO_OPTIMIZED' : 'STANDARD',
          writers: input.members.filter((m) => m.writer).length,
          readers: input.members.filter((m) => !m.writer).length,
          serverlessMinCapacity: cluster.serverlessMinCapacity,
          storageGb: usage.storageGb === null ? null : round(usage.storageGb),
          monthlyIoRequests: usage.monthlyIoRequests === null ? null : Math.round(usage.monthlyIoRequests),
        },
      },
      notes,
    };
    if (cluster.status !== 'available') {
      return buildServiceAnalysis({ ...base, finding: 'NOT_AVAILABLE', notes: [...notes, `Cluster status is ${cluster.status}`] }, 'rds', [], currency, now);
    }
    const idle = this.clusterIdle(input, instancesCost);
    const opportunities = idle ? [idle] : [...this.idleReaders(input), ...this.serverlessFloor(input), ...this.storageMode(input)];
    return buildServiceAnalysis(base, 'rds', opportunities, currency, now);
  }

  private clusterIdle(input: AuroraAnalyzerInput, instancesCost: number | null): ServiceOpportunity | null {
    const { cluster, members } = input;
    if (members.length === 0 || !members.every((m) => this.noConnections(m))) return null;
    return {
      type: RecommendationType.AURORA_CLUSTER_IDLE,
      targetKey: 'DELETE',
      title: `Idle Aurora cluster ${cluster.clusterId}`,
      reasons: [
        `No connections to any of the ${members.length} instances in ${input.usage.periodDays} days`,
        'Take a final cluster snapshot before deleting: deletion is irreversible',
        'Storage, I/O and backups are not included in the savings',
      ],
      monthlySavings: instancesCost,
      risk: Level.MEDIUM,
      confidence: Level.HIGH,
    };
  }

  private idleReaders(input: AuroraAnalyzerInput): ServiceOpportunity[] {
    const readers = input.members.filter((m) => !m.writer);
    return readers
      .filter((m) => m.status === 'available' && this.noConnections(m))
      .map((m) => {
        const cost = this.memberCost(m, this.mode(input));
        const last = readers.length === 1;
        return {
          type: RecommendationType.AURORA_READER_IDLE,
          targetKey: 'DELETE',
          title: `Idle Aurora reader ${m.dbInstanceId}`,
          reasons: [
            `Reader of ${input.cluster.clusterId} had no connections in ${input.usage.periodDays} days`,
            last
              ? 'It is the only reader: without it, a failure of the writer takes about 10 minutes to recover instead of a fast failover'
              : 'Other readers remain as failover targets',
            'Check its failover priority tier before deleting',
          ],
          monthlySavings: cost,
          risk: last ? Level.HIGH : Level.MEDIUM,
          confidence: last ? Level.MEDIUM : Level.HIGH,
          resourceId: m.dbInstanceId,
          resourceArn: m.arn,
          currentMonthlyCost: cost,
        };
      });
  }

  private serverlessFloor(input: AuroraAnalyzerInput): ServiceOpportunity[] {
    const min = input.cluster.serverlessMinCapacity;
    const serverless = input.members.filter((m) => m.instanceClass === AURORA_SERVERLESS_CLASS);
    if (min === null || min <= AURORA_LOWEST_CAPACITY || serverless.length === 0) return [];
    const series = serverless.map((m) => m.capacity?.values ?? []);
    if (series.some((values) => values.length < IDLE_MIN_DATAPOINTS)) return [];
    const values = series.flat();
    const ratio = values.filter((v) => v <= min * AURORA_FLOOR_TOLERANCE).length / values.length;
    if (ratio < AURORA_FLOOR_MIN_RATIO) return [];
    const price = this.mode(input).acuHour;
    const ceiling = price === null ? null : round((min - AURORA_LOWEST_CAPACITY) * price * HOURS_PER_MONTH * serverless.length);
    return [
      {
        type: RecommendationType.AURORA_SERVERLESS_MIN_CAPACITY,
        targetKey: 'LOWER_MIN_CAPACITY',
        title: `Lower the minimum capacity of Aurora Serverless ${input.cluster.clusterId}`,
        reasons: [
          `The ${serverless.length} serverless instances sat at the minimum of ${min} ACU in ${round(ratio * 100)}% of the hours`,
          'Lower the minimum in steps and watch the buffer cache hit ratio and query latency: a lower minimum also lowers max_connections and scales up more slowly',
          ceiling === null ? 'ACU price unavailable' : `How low the database can go is unknown before the change: the saving is at most ${input.currency} ${ceiling}/month at ${AURORA_LOWEST_CAPACITY} ACU`,
        ],
        monthlySavings: null,
        risk: Level.MEDIUM,
        confidence: Level.MEDIUM,
      },
    ];
  }

  private storageMode(input: AuroraAnalyzerInput): ServiceOpportunity[] {
    const standard = this.modeTotal(input, false);
    const optimized = this.modeTotal(input, true);
    if (standard === null || optimized === null) return [];
    const { ioOptimized, clusterId } = input.cluster;
    const current = ioOptimized ? optimized : standard;
    const savings = current - (ioOptimized ? standard : optimized);
    if (savings < AURORA_MODE_MIN_SAVINGS || savings < current * AURORA_MODE_MIN_RATIO) return [];
    const target = ioOptimized ? 'Standard' : 'I/O-Optimized';
    return [
      {
        type: RecommendationType.AURORA_STORAGE_MODE,
        targetKey: ioOptimized ? 'STANDARD' : 'IO_OPTIMIZED',
        title: `Move Aurora ${clusterId} to ${target}`,
        reasons: [
          `Estimated on-demand cost: Standard ${input.currency} ${round(standard)}/month, I/O-Optimized ${input.currency} ${round(optimized)}/month, with ${Math.round(input.usage.monthlyIoRequests ?? 0)} billed I/O requests per month`,
          'A cluster can move to I/O-Optimized once every 30 days and back to Standard at any time',
          'Reserved Instances cover fewer normalized units in I/O-Optimized: check them before the change',
        ],
        monthlySavings: savings,
        risk: Level.LOW,
        confidence: Level.MEDIUM,
      },
    ];
  }

  private noConnections(member: AuroraMember): boolean {
    return member.metrics?.connectionsMax === 0 && member.metrics.connectionsDatapoints >= IDLE_MIN_DATAPOINTS;
  }

  private mode(input: AuroraAnalyzerInput, ioOptimized = input.cluster.ioOptimized): AuroraModePrices {
    return ioOptimized ? input.prices.ioOptimized : input.prices.standard;
  }

  private memberCost(member: AuroraMember, prices: AuroraModePrices): number | null {
    if (member.instanceClass !== AURORA_SERVERLESS_CLASS) return prices.byClass[member.instanceClass]?.monthly ?? null;
    const values = member.capacity?.values ?? [];
    if (prices.acuHour === null || values.length === 0) return null;
    return (values.reduce((a, b) => a + b, 0) / values.length) * prices.acuHour * HOURS_PER_MONTH;
  }

  private instancesCost(input: AuroraAnalyzerInput, prices: AuroraModePrices): number | null {
    return input.members.reduce<number | null>((sum, m) => {
      const cost = this.memberCost(m, prices);
      return sum === null || cost === null ? null : sum + cost;
    }, 0);
  }

  private storageIoCost(input: AuroraAnalyzerInput, ioOptimized: boolean): number | null {
    const { usage, prices } = input;
    const perGb = this.mode(input, ioOptimized).storageGbMonth;
    if (usage.storageGb === null || perGb === null) return null;
    if (ioOptimized) return usage.storageGb * perGb;
    if (usage.monthlyIoRequests === null || prices.ioRequest === null) return null;
    return usage.storageGb * perGb + usage.monthlyIoRequests * prices.ioRequest;
  }

  private modeTotal(input: AuroraAnalyzerInput, ioOptimized: boolean): number | null {
    const instances = this.instancesCost(input, this.mode(input, ioOptimized));
    const storage = this.storageIoCost(input, ioOptimized);
    return instances === null || storage === null ? null : instances + storage;
  }
}
