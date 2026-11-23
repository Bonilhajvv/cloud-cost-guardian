import { Injectable } from '@nestjs/common';
import { Level, RecommendationSource, RecommendationType } from '../../common/enums';
import { round } from '../../common/helpers/stats.helper';
import { RecommendationDraft } from '../core/interfaces/recommendation-draft.interface';
import { mapPerformanceRisk, maxLevel, severityFor } from '../ec2/helpers/risk-level.helper';
import { HOURS_PER_MONTH } from '../pricing/constants/pricing.constant';
import {
  CONNECTIONS_BLOCK_RATIO,
  CONNECTIONS_HIGH_RISK_RATIO,
  DAY_MS,
  IDLE_MIN_DATAPOINTS,
  RDS_GP3_LARGE_GB,
  RDS_IO_STORAGE_TYPES,
  RDS_MIN_STORAGE_GB,
  RDS_PERFORMANCE_HEADROOM,
  RDS_STORAGE_HEADROOM,
  RDS_STORAGE_MIN_SAVINGS,
  RDS_STORAGE_SHRINK_MAX_RATIO,
  SMALL_CLASS_MEMORY_GB,
  SUPPORT_ENDING_SOON_DAYS,
} from './constants/rds.constant';
import { isAuroraEngine } from './helpers/aurora.helper';
import { connectionLimit } from './helpers/max-connections.helper';
import { gp3Baseline, storageMonthlyCost } from './helpers/rds-storage.helper';
import { detectEnvironment } from '../core/helpers/environment.helper';
import { inExtendedSupport } from './helpers/rds-lifecycle.helper';
import { RdsAnalysis, RdsAnalyzerInput, RdsAnalyzerResult } from './interfaces/rds-analysis.interface';

interface Opportunity {
  type: RecommendationType;
  targetKey: string;
  title: string;
  description: string;
  monthlySavings: number | null;
  recommendedMonthlyCost?: number | null;
  severity?: Level;
  risk: Level;
  confidence: Level;
}

@Injectable()
export class RdsAnalyzerService {
  analyze(input: RdsAnalyzerInput): RdsAnalyzerResult {
    const { instance, metrics, optimizer, prices, lifecycle } = input;
    const now = input.now ?? new Date();
    const price = prices?.byClass[instance.instanceClass] ?? null;
    const monthlyCost = price?.monthly ?? null;
    const extendedSupportCost = this.extendedSupportCost(input, price?.vcpu ?? null, now);
    const aurora = isAuroraEngine(instance.engine);
    const storageCost = aurora ? null : storageMonthlyCost(instance, prices?.storage);
    const notes: string[] = [];
    if (monthlyCost === null) notes.push('Instance price unavailable');
    else notes.push(`Monthly cost estimated from on-demand price (RI discounts${storageCost === null ? ' and storage' : ''} not included)`);

    const analysis: RdsAnalysis = {
      kind: 'RDS',
      resourceId: instance.dbInstanceId,
      resourceArn: instance.arn,
      name: instance.dbInstanceId,
      region: instance.region,
      finding: 'OPTIMIZED',
      environment: detectEnvironment(instance.dbInstanceId, instance.tags, input.environmentOverride ?? null),
      current: {
        instanceClass: instance.instanceClass,
        engine: instance.engine,
        engineVersion: instance.engineVersion,
        multiAz: instance.multiAz,
        vcpu: price?.vcpu ?? null,
        monthlyCost: monthlyCost === null ? null : round(monthlyCost + (extendedSupportCost ?? 0) + (storageCost ?? 0)),
        storageMonthlyCost: storageCost,
        storageType: aurora ? null : instance.storageType,
        allocatedStorageGb: aurora ? null : instance.allocatedStorageGb,
        extendedSupportMonthlyCost: extendedSupportCost === null ? null : round(extendedSupportCost),
        standardSupportEnd: lifecycle?.standardSupportEnd ?? null,
      },
      metrics: {
        periodDays: metrics?.periodDays ?? null,
        cpuP95: metrics?.cpu.p95 ?? null,
        cpuMax: metrics?.cpu.max ?? null,
        connectionsMax: metrics?.connectionsMax ?? null,
        memoryMaxPercent: optimizer?.utilization['Memory Maximum'] === undefined ? null : round(optimizer.utilization['Memory Maximum']),
        freeStorageMinGb: metrics?.freeStorageMinGb ?? null,
        peakIops: metrics?.peakIops ?? null,
        notes,
      },
      recommendation: null,
      opportunities: [],
      savings: null,
      analyzedAt: now.toISOString(),
    };

    if (instance.status !== 'available') {
      analysis.finding = 'NOT_AVAILABLE';
      notes.push(`Database status is ${instance.status}`);
      return { analysis, drafts: [] };
    }
    if (instance.clusterId && !aurora) {
      analysis.finding = 'NOT_ANALYZED';
      notes.push('Multi-AZ DB cluster members are not analyzed yet');
      return { analysis, drafts: [] };
    }

    const idle = aurora ? null : this.idle(analysis, input, monthlyCost === null ? null : monthlyCost + (storageCost ?? 0));
    if (aurora) notes.push('Idle readers, storage and I/O are analyzed on the Aurora cluster');
    const opportunities = idle
      ? [idle]
      : [
          this.resize(analysis, input),
          ...(aurora ? [] : [this.multiAz(analysis, input), this.storage(input)]),
          this.extendedSupport(analysis, input, extendedSupportCost, now),
          this.publicAccess(input),
        ].filter(
          (o): o is Opportunity => o !== null,
        );
    if (!idle) this.supportEndingSoon(analysis, input, now);
    analysis.opportunities = opportunities.map((o) => o.type);
    const total = opportunities.reduce<number | null>((sum, o) => (sum === null || o.monthlySavings === null ? sum : sum + o.monthlySavings), 0);
    if (total !== null && total > 0) analysis.savings = { monthly: round(total), yearly: round(total * 12), currency: input.currency };
    return { analysis, drafts: opportunities.map((o) => this.draft(analysis, o, input.currency)) };
  }

  private idle(analysis: RdsAnalysis, input: RdsAnalyzerInput, monthlyCost: number | null): Opportunity | null {
    const { instance, metrics, optimizer } = input;
    if (instance.replicaIds.length > 0) return null;
    const noConnections = metrics?.connectionsMax === 0 && metrics.connectionsDatapoints >= IDLE_MIN_DATAPOINTS;
    if (!noConnections && optimizer?.idle !== true) return null;
    const reasons = [
      noConnections
        ? `No database connections in ${analysis.metrics.periodDays} days`
        : 'AWS Compute Optimizer reports the database as idle',
      ...(instance.readReplicaSourceId ? [`Read replica of ${instance.readReplicaSourceId} that nobody reads from`] : []),
      'Take a final snapshot before deleting: deletion is irreversible and the snapshot keeps the data for a fraction of the price',
      `${analysis.current.storageMonthlyCost ? 'Backups' : 'Storage and backups'} of the instance are not included in the savings`,
    ];
    analysis.finding = 'IDLE';
    analysis.recommendation = {
      type: RecommendationType.RDS_IDLE,
      source: noConnections ? RecommendationSource.CCG_HEURISTIC : RecommendationSource.COMPUTE_OPTIMIZER,
      instanceClass: null,
      performanceRisk: Level.MEDIUM,
      confidence: noConnections ? Level.HIGH : Level.MEDIUM,
      reasons,
    };
    return {
      type: RecommendationType.RDS_IDLE,
      targetKey: 'DELETE',
      title: `Idle RDS database ${instance.dbInstanceId}`,
      description: `${instance.dbInstanceId} (${instance.instanceClass}, ${instance.engine}) looks unused. ${reasons.join('. ')}. Estimated savings: ${this.savingsText(monthlyCost, input.currency)}.`,
      monthlySavings: monthlyCost,
      risk: Level.MEDIUM,
      confidence: analysis.recommendation.confidence,
    };
  }

  private resize(analysis: RdsAnalysis, input: RdsAnalyzerInput): Opportunity | null {
    const { instance, optimizer, prices } = input;
    if (!optimizer) return null;
    const ranked = [...optimizer.options].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).filter((o) => o.instanceClass !== instance.instanceClass);
    const memory = analysis.metrics.memoryMaxPercent;
    const usage = [
      `Observed maximum: CPU ${optimizer.utilization['CPU Maximum'] === undefined ? 'unknown' : round(optimizer.utilization['CPU Maximum'])}%, memory ${memory ?? 'unknown'}%, ${optimizer.utilization['DatabaseConnections Maximum'] ?? 'unknown'} connections`,
    ];
    const restart = isAuroraEngine(instance.engine)
      ? 'Changing the class restarts the instance: resize a reader first and fail over to it'
      : instance.multiAz
      ? 'Changing the class triggers a Multi-AZ failover (about 1-2 minutes of interruption)'
      : 'Changing the class restarts the database: schedule it in a maintenance window';

    if (optimizer.finding === 'UNDER_PROVISIONED') {
      const target = ranked[0];
      if (!target) return null;
      const targetCost = prices?.byClass[target.instanceClass]?.monthly ?? null;
      const current = analysis.current.monthlyCost;
      const increase = targetCost !== null && prices?.byClass[instance.instanceClass] ? round(targetCost - prices.byClass[instance.instanceClass].monthly) : null;
      const reasons = ['AWS Compute Optimizer reports the database as under-provisioned', ...usage, restart];
      analysis.finding = 'UPSIZE';
      analysis.recommendation = {
        type: RecommendationType.RDS_UPSIZE,
        source: RecommendationSource.COMPUTE_OPTIMIZER,
        instanceClass: target.instanceClass,
        performanceRisk: Level.HIGH,
        confidence: Level.HIGH,
        reasons,
      };
      return {
        type: RecommendationType.RDS_UPSIZE,
        targetKey: target.instanceClass,
        title: `Upsize RDS ${instance.dbInstanceId}: ${instance.instanceClass} to ${target.instanceClass}`,
        description: `${instance.dbInstanceId} may be slow or run out of memory. ${reasons.join('. ')}. ${increase === null ? 'Cost increase unknown (price unavailable)' : `Cost increase: ${input.currency} ${increase}/month`}.`,
        monthlySavings: null,
        recommendedMonthlyCost: current !== null && increase !== null ? round(current + increase) : null,
        severity: Level.HIGH,
        risk: Level.HIGH,
        confidence: Level.HIGH,
      };
    }

    if (optimizer.finding !== 'OVER_PROVISIONED') return null;
    const cheaper = ranked.filter((o) => (o.estimatedMonthlySavings ?? 0) > 0).map((option) => ({ option, connections: this.connectionCheck(input, option.instanceClass) }));
    const chosen = cheaper.find((c) => !c.connections.blocked);
    for (const c of cheaper.slice(0, chosen ? cheaper.indexOf(chosen) : undefined)) analysis.metrics.notes.push(`${c.option.instanceClass} discarded: ${c.connections.reason}`);
    if (!chosen) return null;
    const target = chosen.option;
    const risk = maxLevel(maxLevel(mapPerformanceRisk(target.performanceRisk), Level.MEDIUM), chosen.connections.highRisk ? Level.HIGH : Level.MEDIUM);
    const reasons = [
      `AWS Compute Optimizer finding: over-provisioned (rank ${target.rank ?? '-'})`,
      ...usage,
      chosen.connections.reason,
      'A smaller class has less memory for the buffer cache: watch query latency and read IOPS after the change',
      restart,
    ];
    analysis.finding = 'RIGHTSIZE';
    analysis.recommendation = {
      type: RecommendationType.RDS_RIGHTSIZING,
      source: RecommendationSource.COMPUTE_OPTIMIZER,
      instanceClass: target.instanceClass,
      performanceRisk: risk,
      confidence: Level.HIGH,
      reasons,
    };
    return {
      type: RecommendationType.RDS_RIGHTSIZING,
      targetKey: target.instanceClass,
      title: `Rightsize RDS ${instance.dbInstanceId}: ${instance.instanceClass} to ${target.instanceClass}`,
      description: `${reasons.join('. ')}. Estimated savings: ${this.savingsText(target.estimatedMonthlySavings, input.currency)}.`,
      monthlySavings: target.estimatedMonthlySavings,
      risk,
      confidence: Level.HIGH,
    };
  }

  private connectionCheck(input: RdsAnalyzerInput, instanceClass: string): { blocked: boolean; highRisk: boolean; reason: string } {
    const observed = [input.metrics?.connectionsMax, input.optimizer?.utilization['DatabaseConnections Maximum']].filter((v): v is number => typeof v === 'number');
    const peak = observed.length ? Math.max(...observed) : null;
    const memoryGb = input.prices?.byClass[instanceClass]?.memoryGb ?? null;
    const limit = connectionLimit(input.instance, memoryGb, input.maxConnections);
    const unknown = (reason: string) => ({ blocked: false, highRisk: false, reason });
    if (!limit) return unknown(`max_connections of ${instanceClass} is unknown: compare it with the connection peak${peak === null ? '' : ` of ${peak}`} before the change`);
    if (limit.fixed) return unknown(`max_connections is fixed at ${limit.limit} in the parameter group: it does not shrink with the class, but each connection uses memory${peak === null ? '' : ` (peak of ${peak} connections)`}`);
    const label = `at most ${limit.limit} connections (max_connections formula${limit.assumed ? ', engine default assumed because the parameter group was not read' : ''})`;
    if (peak === null) return unknown(`${instanceClass} accepts ${label}; the connection peak is unknown`);
    const ratio = peak / limit.limit;
    const blockRatio = memoryGb !== null && memoryGb <= SMALL_CLASS_MEMORY_GB ? CONNECTIONS_HIGH_RISK_RATIO : CONNECTIONS_BLOCK_RATIO;
    return {
      blocked: ratio > blockRatio,
      highRisk: ratio > CONNECTIONS_HIGH_RISK_RATIO,
      reason: `the peak of ${peak} connections is ${Math.round(ratio * 100)}% of what ${instanceClass} accepts: ${label}`,
    };
  }

  private multiAz(analysis: RdsAnalysis, input: RdsAnalyzerInput): Opportunity | null {
    const { instance, prices } = input;
    if (!instance.multiAz) return null;
    const environment = analysis.environment;
    if (environment?.environment !== 'NON_PRODUCTION') return null;
    const multi = prices?.byClass[instance.instanceClass]?.monthly;
    const single = prices?.singleAz?.monthly;
    const storageMulti = storageMonthlyCost(instance, prices?.storage);
    const storageSingle = storageMonthlyCost(instance, prices?.singleAzStorage);
    const storageSavings = storageMulti !== null && storageSingle !== null ? storageMulti - storageSingle : null;
    const savings = multi !== undefined && single !== undefined && single !== null ? multi - single + (storageSavings ?? 0) : null;
    const reasons = [
      `Non-production database (${environment.detail}) running Multi-AZ, which doubles the instance price`,
      'Single-AZ loses automatic failover: acceptable outside production',
      'Online change (ModifyDBInstance --no-multi-az), no restart',
    ];
    return {
      type: RecommendationType.RDS_MULTI_AZ,
      targetKey: 'SINGLE_AZ',
      title: `Turn off Multi-AZ on non-production RDS ${instance.dbInstanceId}`,
      description: `${reasons.join('. ')}. Estimated savings: ${this.savingsText(savings, input.currency)} (Multi-AZ storage savings ${storageSavings === null ? 'not ' : ''}included).`,
      monthlySavings: savings,
      risk: Level.LOW,
      confidence: environment.source === 'NAME' ? Level.MEDIUM : Level.HIGH,
    };
  }

  private storage(input: RdsAnalyzerInput): Opportunity | null {
    return this.storageType(input) ?? this.storageShrink(input);
  }

  private storageType(input: RdsAnalyzerInput): Opportunity | null {
    const { instance, metrics, prices } = input;
    const size = instance.allocatedStorageGb;
    if (!instance.storageType || !RDS_IO_STORAGE_TYPES.includes(instance.storageType) || size === null) return null;
    const peakIops = metrics?.peakIops ?? null;
    const peakMbps = metrics?.peakThroughputMBps ?? null;
    if (peakIops === null || peakMbps === null || (metrics?.freeStorageDatapoints ?? 0) < IDLE_MIN_DATAPOINTS) return null;
    const baseline = gp3Baseline(size);
    if (peakIops * RDS_PERFORMANCE_HEADROOM > baseline.iops || peakMbps * RDS_PERFORMANCE_HEADROOM > baseline.mbps) return null;
    const current = storageMonthlyCost(instance, prices?.storage);
    const target = storageMonthlyCost({ storageType: 'gp3', allocatedStorageGb: size, iops: null }, prices?.storage);
    if (current === null || target === null || current - target < RDS_STORAGE_MIN_SAVINGS) return null;
    const reasons = [
      `${instance.storageType} with ${instance.iops} provisioned IOPS, but the peak of ${metrics?.periodDays} days was ${peakIops} IOPS and ${peakMbps} MB/s`,
      `gp3 includes ${baseline.iops} IOPS and ${baseline.mbps} MB/s at ${size} GB`,
      'gp3 has higher and less consistent latency than io1/io2: check the application tolerates it',
      'Online change, but the storage stays in optimization for hours and cannot be modified again for 6 hours',
    ];
    return {
      type: RecommendationType.RDS_STORAGE_TYPE,
      targetKey: 'gp3',
      title: `Move RDS ${instance.dbInstanceId} storage from ${instance.storageType} to gp3`,
      description: `${reasons.join('. ')}. Estimated savings: ${this.savingsText(current - target, input.currency)}.`,
      monthlySavings: current - target,
      risk: Level.MEDIUM,
      confidence: Level.MEDIUM,
    };
  }

  private storageShrink(input: RdsAnalyzerInput): Opportunity | null {
    const { instance, metrics, prices } = input;
    const size = instance.allocatedStorageGb;
    const free = metrics?.freeStorageMinGb ?? null;
    if (size === null || free === null || instance.readReplicaSourceId || (metrics?.freeStorageDatapoints ?? 0) < IDLE_MIN_DATAPOINTS) return null;
    const used = Math.max(0, size - free);
    const target = Math.max(RDS_MIN_STORAGE_GB, Math.ceil(used * RDS_STORAGE_HEADROOM));
    if (target > size * RDS_STORAGE_SHRINK_MAX_RATIO) return null;
    const baselineLoss = gp3Baseline(target).iops < gp3Baseline(size).iops;
    const peakIops = metrics?.peakIops ?? null;
    if (baselineLoss && (peakIops === null || peakIops * RDS_PERFORMANCE_HEADROOM > gp3Baseline(target).iops)) return null;
    const current = storageMonthlyCost(instance, prices?.storage);
    const next = storageMonthlyCost({ ...instance, allocatedStorageGb: target }, prices?.storage);
    if (current === null || next === null || current - next < RDS_STORAGE_MIN_SAVINGS) return null;
    const reasons = [
      `${size} GB allocated, at most ${round(used)} GB used in ${metrics?.periodDays} days: ${target} GB leaves 30% of headroom`,
      'RDS cannot shrink storage in place: use a Blue/Green deployment with a smaller volume, or dump and restore into a new instance',
      'Check the growth trend before: the analysis only sees the last days',
      ...(instance.storageType === 'gp2' ? ['gp2 performance depends on the size: move to gp3 in the same change'] : []),
      ...(baselineLoss ? [`Below ${RDS_GP3_LARGE_GB} GB the gp3 baseline drops to ${gp3Baseline(target).iops} IOPS, still above the observed peak of ${peakIops}`] : []),
    ];
    return {
      type: RecommendationType.RDS_STORAGE_SHRINK,
      targetKey: 'SHRINK',
      title: `Shrink RDS ${instance.dbInstanceId} storage: ${size} GB to ${target} GB`,
      description: `${reasons.join('. ')}. Estimated savings: ${this.savingsText(current - next, input.currency)}.`,
      monthlySavings: current - next,
      risk: Level.HIGH,
      confidence: Level.MEDIUM,
    };
  }

  private extendedSupport(analysis: RdsAnalysis, input: RdsAnalyzerInput, cost: number | null, now: Date): Opportunity | null {
    const { instance, lifecycle } = input;
    if (!lifecycle || !inExtendedSupport(lifecycle, now)) return null;
    const ends = lifecycle.extendedSupportEnd?.slice(0, 10) ?? 'unknown';
    const reasons = [
      `${instance.engine} ${lifecycle.majorVersion} left standard support on ${lifecycle.standardSupportEnd?.slice(0, 10)}: AWS charges RDS Extended Support per vCPU-hour until ${ends}`,
      'Upgrade to a supported major version: test it first on a snapshot copy or with a Blue/Green deployment',
      'A major version upgrade restarts the database and may need application changes',
    ];
    return {
      type: RecommendationType.RDS_EXTENDED_SUPPORT,
      targetKey: 'UPGRADE_ENGINE',
      title: `Upgrade RDS ${instance.dbInstanceId}: ${instance.engine} ${lifecycle.majorVersion} is in paid Extended Support`,
      description: `${reasons.join('. ')}. Estimated savings: ${this.savingsText(cost, input.currency)}.`,
      monthlySavings: cost,
      risk: Level.HIGH,
      confidence: Level.HIGH,
    };
  }

  private publicAccess(input: RdsAnalyzerInput): Opportunity | null {
    const { instance, prices } = input;
    if (!instance.publiclyAccessible) return null;
    const savings = prices?.publicIpv4Monthly ?? null;
    const reasons = [
      `${instance.dbInstanceId} is publicly accessible: its endpoint resolves to a public IPv4 address reachable from the internet, limited only by security groups`,
      `AWS charges the public IPv4 address${savings === null ? '' : ` (${input.currency} ${round(savings)}/month)`}`,
      'Make it private (ModifyDBInstance --no-publicly-accessible) and reach it from inside the VPC, a VPN or an SSM/bastion tunnel',
      'Clients that connect from outside the VPC stop working: check them before the change',
    ];
    return {
      type: RecommendationType.RDS_PUBLIC_ACCESS,
      targetKey: 'PRIVATE',
      title: `Make RDS ${instance.dbInstanceId} private`,
      description: `${reasons.join('. ')}. Estimated savings: ${this.savingsText(savings, input.currency)}.`,
      monthlySavings: savings,
      severity: Level.MEDIUM,
      risk: Level.MEDIUM,
      confidence: Level.HIGH,
    };
  }

  private supportEndingSoon(analysis: RdsAnalysis, input: RdsAnalyzerInput, now: Date): void {
    const end = input.lifecycle?.standardSupportEnd ? Date.parse(input.lifecycle.standardSupportEnd) : null;
    if (end === null || end < now.getTime()) return;
    const days = Math.ceil((end - now.getTime()) / DAY_MS);
    if (days <= SUPPORT_ENDING_SOON_DAYS) {
      analysis.metrics.notes.push(`${input.instance.engine} ${input.lifecycle?.majorVersion} leaves standard support in ${days} days: plan the upgrade to avoid Extended Support charges`);
    }
  }

  private extendedSupportCost(input: RdsAnalyzerInput, vcpu: number | null, now: Date): number | null {
    if (!inExtendedSupport(input.lifecycle, now) || input.extendedSupportHourlyPerVcpu === null || vcpu === null) return null;
    return input.extendedSupportHourlyPerVcpu * vcpu * HOURS_PER_MONTH * (input.instance.multiAz && !isAuroraEngine(input.instance.engine) ? 2 : 1);
  }

  private savingsText(monthly: number | null, currency: string): string {
    return monthly === null ? 'savings unknown (price unavailable)' : `${currency} ${round(monthly)}/month`;
  }

  private draft(analysis: RdsAnalysis, o: Opportunity, currency: string): RecommendationDraft {
    const monthly = o.monthlySavings === null ? null : round(o.monthlySavings);
    const current = analysis.current.monthlyCost;
    return {
      resourceId: analysis.resourceId,
      resourceArn: analysis.resourceArn,
      service: 'rds',
      type: o.type,
      source: o.type === RecommendationType.RDS_RIGHTSIZING || o.type === RecommendationType.RDS_UPSIZE ? RecommendationSource.COMPUTE_OPTIMIZER : RecommendationSource.CCG_HEURISTIC,
      title: o.title,
      description: o.description,
      severity: o.severity ?? severityFor(monthly),
      risk: o.risk,
      confidence: o.confidence,
      currentMonthlyCost: current,
      recommendedMonthlyCost:
        o.recommendedMonthlyCost !== undefined ? o.recommendedMonthlyCost : current !== null && monthly !== null ? round(Math.max(0, current - monthly)) : null,
      estimatedMonthlySavings: monthly,
      estimatedYearlySavings: monthly === null ? null : round(monthly * 12),
      currency,
      targetKey: o.targetKey,
      analysis,
    };
  }
}
