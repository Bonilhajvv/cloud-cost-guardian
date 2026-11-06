import { Injectable } from '@nestjs/common';
import { Level, RecommendationSource, RecommendationType } from '../../common/enums';
import { round } from '../../common/helpers/stats.helper';
import { Ec2OptimizerOption } from '../optimizer/interfaces/ec2-optimizer.interface';
import {
  CostSource,
  Ec2Analysis,
  Ec2AnalyzerInput,
  Ec2AnalyzerOutput,
} from './interfaces/ec2-analysis.interface';
import { RecommendationDraft } from '../core/interfaces/recommendation-draft.interface';
import { RecommendationCandidate } from './interfaces/recommendation-candidate.interface';
import { ANALYZER_THRESHOLDS } from './constants/analyzer-thresholds.constant';
import { K8S_MIN_MEMORY_GIB } from './constants/kubernetes.constant';
import { burstableBaselinePercent } from './helpers/burstable.helper';
import { buildInstanceOption, OptionCandidate, sameSizeAlternatives } from './helpers/instance-options.helper';
import { kubernetesInfoFromStats, withExternalMemory } from './helpers/external-memory.helper';
import { detectKubernetesNode } from './helpers/kubernetes-node.helper';
import { buildUsageProfile } from './helpers/usage-profile.helper';
import { mapPerformanceRisk, maxLevel, severityFor } from './helpers/risk-level.helper';
import { InstanceTypeSpec } from './interfaces/ec2-instance.interface';
import { InstanceOption } from './interfaces/usage-profile.interface';

@Injectable()
export class Ec2AnalyzerService {
  analyze(input: Ec2AnalyzerInput): Ec2AnalyzerOutput {
    const { instance, optimizer } = input;
    const metrics = withExternalMemory(input.metrics, input.externalMemory);
    const cost = this.resolveCurrentCost(input);
    const memory = metrics?.memory;
    const networkBytes =
      metrics && metrics.networkInBytesPerDay !== null && metrics.networkOutBytesPerDay !== null
        ? metrics.networkInBytesPerDay + metrics.networkOutBytesPerDay
        : null;
    const datapoints = metrics?.cpu.datapoints ?? 0;
    const hasEnoughData = datapoints >= ANALYZER_THRESHOLDS.minDatapoints;
    const notes: string[] = [];
    if (memory && !memory.available) notes.push(memory.reason);
    if (!hasEnoughData) notes.push(`Only ${datapoints} hourly CPU datapoints available`);
    if (cost.source === 'UNAVAILABLE') notes.push('Monthly cost unavailable');
    if (cost.source === 'ON_DEMAND_PRICE') notes.push('Monthly cost estimated from on-demand price (RI/Savings Plans discounts not considered)');
    const kubernetes = kubernetesInfoFromStats(detectKubernetesNode(instance), input.externalMemory);
    if (metrics?.memory.available && metrics.memory.source === 'KUBERNETES_AGENT') {
      notes.push(`Memory from Cloud Cost Guardian Kubernetes agent (${input.externalMemory?.clusterName}): P95 uses the higher of real usage and pod memory requests`);
    }
    const credits = metrics?.cpuCredits ?? null;
    const disk = metrics?.disk;
    if (credits && credits.surplusChargedTotal > 0) {
      notes.push(`Unlimited mode charged ${credits.surplusChargedTotal} surplus CPU credits: CPU is above baseline`);
    }
    if (credits?.balanceMin === 0) notes.push('CPU credit balance reached 0 during the period');
    if (disk?.available && disk.p95UsedPercent >= ANALYZER_THRESHOLDS.diskHighUsedPercent) {
      notes.push(`Disk usage high: P95 ${disk.p95UsedPercent}%, max ${disk.maxUsedPercent}%`);
    }

    const analysis: Ec2Analysis = {
      kind: 'EC2',
      resourceId: instance.instanceId,
      resourceArn: instance.arn,
      name: instance.name,
      region: instance.region,
      finding: 'OPTIMIZED',
      kubernetes,
      current: {
        instanceType: instance.instanceType,
        vcpu: instance.vcpu,
        memoryGb: instance.memoryGiB,
        monthlyCost: cost.amount === null ? null : round(cost.amount),
        costSource: cost.source,
      },
      metrics: {
        periodDays: metrics?.periodDays ?? null,
        cpuAverage: metrics?.cpu.average ?? null,
        cpuP95: metrics?.cpu.p95 ?? null,
        cpuMax: metrics?.cpu.max ?? null,
        networkMbPerDay: networkBytes === null ? null : round(networkBytes / 1024 / 1024),
        memoryAvailable: memory?.available ?? false,
        memorySource: memory?.available ? (memory.source ?? 'CLOUDWATCH_AGENT') : null,
        memoryP95: memory?.available ? memory.usedPercent.p95 : null,
        cpuCreditBalanceMin: credits?.balanceMin ?? null,
        cpuSurplusCreditsCharged: credits?.surplusChargedTotal ?? null,
        diskMaxUsedPercent: disk?.available ? disk.maxUsedPercent : null,
        notes,
      },
      recommendation: null,
      reduction: null,
      savings: null,
      analyzedAt: new Date().toISOString(),
    };

    analysis.usage = buildUsageProfile(instance, metrics, analysis.metrics.networkMbPerDay);
    analysis.options = this.buildOptions(analysis, input);

    if (instance.state !== 'running') {
      analysis.finding = 'NOT_RUNNING';
      return { analysis, draft: null };
    }

    const candidate =
      this.idleCandidate(analysis, hasEnoughData, cost.amount) ??
      this.optimizerCandidate(analysis, input, hasEnoughData) ??
      this.heuristicCandidate(analysis, input, cost.amount, hasEnoughData);

    if (!candidate) {
      analysis.finding = !hasEnoughData && !optimizer ? 'INSUFFICIENT_DATA' : 'OPTIMIZED';
      return { analysis, draft: null };
    }

    analysis.finding = candidate.type === RecommendationType.EC2_IDLE ? 'IDLE' : 'RIGHTSIZE';
    analysis.recommendation = {
      type: candidate.type,
      source: candidate.source,
      instanceType: candidate.targetType,
      vcpu: candidate.target?.vcpu ?? null,
      memoryGb: candidate.target?.memoryGiB ?? null,
      performanceRisk: candidate.risk,
      confidence: candidate.confidence,
      reasons: candidate.reasons,
    };
    if (candidate.target && instance.vcpu !== null && instance.memoryGiB !== null) {
      analysis.reduction = {
        vcpu: { from: instance.vcpu, to: candidate.target.vcpu },
        memoryGb: { from: instance.memoryGiB, to: candidate.target.memoryGiB },
      };
    }
    if (candidate.monthlySavings !== null) {
      analysis.savings = {
        monthly: round(candidate.monthlySavings),
        yearly: round(candidate.monthlySavings * 12),
        currency: input.currency,
      };
    }
    return { analysis, draft: this.toDraft(analysis, candidate, input.currency) };
  }

  private resolveCurrentCost(input: Ec2AnalyzerInput): { amount: number | null; source: CostSource } {
    if (input.costExplorerMonthlyCost !== null && input.costExplorerMonthlyCost > 0) {
      return { amount: input.costExplorerMonthlyCost, source: 'COST_EXPLORER_RESOURCE' };
    }
    const option = input.optimizer?.options.find(
      (o) => (o.estimatedMonthlySavings ?? 0) > 0 && (o.savingsPercentage ?? 0) > 0,
    );
    if (option?.estimatedMonthlySavings && option.savingsPercentage) {
      return {
        amount: option.estimatedMonthlySavings / (option.savingsPercentage / 100),
        source: 'COMPUTE_OPTIMIZER',
      };
    }
    const onDemand = input.onDemandMonthlyPrices[input.instance.instanceType];
    if (onDemand !== undefined && onDemand > 0) return { amount: onDemand, source: 'ON_DEMAND_PRICE' };
    return { amount: null, source: 'UNAVAILABLE' };
  }

  private buildOptions(analysis: Ec2Analysis, input: Ec2AnalyzerInput): InstanceOption[] {
    const { instance } = input;
    if (!analysis.usage || instance.vcpu === null || instance.memoryGiB === null) return [];
    const specs = input.typeSpecs ?? {};
    const archs = instance.architecture ? [instance.architecture] : [];
    const candidates: OptionCandidate[] = [
      { kind: 'CURRENT', spec: { instanceType: instance.instanceType, vcpu: instance.vcpu, memoryGiB: instance.memoryGiB, architectures: archs } },
    ];
    if (input.downsizeCandidate) candidates.push({ kind: 'DOWNSIZE', spec: input.downsizeCandidate });
    for (const o of input.optimizer?.options ?? []) {
      if (o.spec) candidates.push({ kind: 'COMPUTE_OPTIMIZER', spec: o.spec, savingsHint: o.estimatedMonthlySavings });
    }
    for (const type of sameSizeAlternatives(instance.instanceType)) {
      if (specs[type]) candidates.push({ kind: 'SAME_SIZE_ALTERNATIVE', spec: specs[type] });
    }
    const seen = new Set<string>();
    const usage = analysis.usage;
    return candidates
      .filter((c) => !seen.has(c.spec.instanceType) && !!seen.add(c.spec.instanceType))
      .map((c) => buildInstanceOption(analysis, usage, c, input.onDemandMonthlyPrices, archs))
      .sort((a, b) =>
        a.kind === 'CURRENT' ? -1 : b.kind === 'CURRENT' ? 1 : (a.monthlyCost ?? Infinity) - (b.monthlyCost ?? Infinity),
      );
  }

  private violatesKubernetesFloor(analysis: Ec2Analysis, target: InstanceTypeSpec | null): boolean {
    const node = analysis.kubernetes;
    if (!node || !target) return false;
    const floor = K8S_MIN_MEMORY_GIB[node.role];
    if (target.memoryGiB >= floor) return false;
    analysis.metrics.notes.push(
      `Kubernetes ${node.role === 'CONTROL_PLANE' ? 'control plane' : 'worker'} node needs at least ${floor} GiB; ${target.instanceType} (${target.memoryGiB} GiB) skipped`,
    );
    return true;
  }

  private kubernetesReasons(analysis: Ec2Analysis): string[] {
    const node = analysis.kubernetes;
    if (!node) return [];
    const where = node.managedBy === 'EKS' ? 'the EKS node group / launch template' : 'the node provisioning (ASG / launch template)';
    return [
      `Kubernetes ${node.role === 'CONTROL_PLANE' ? 'control plane' : 'worker'} node${node.cluster ? ` of cluster ${node.cluster}` : ''}: apply the change through ${where}, draining the node first`,
    ];
  }

  private idleCandidate(
    analysis: Ec2Analysis,
    hasEnoughData: boolean,
    currentCost: number | null,
  ): RecommendationCandidate | null {
    const { cpuP95, cpuMax, networkMbPerDay } = analysis.metrics;
    const t = ANALYZER_THRESHOLDS;
    if (!hasEnoughData || cpuP95 === null || cpuMax === null || networkMbPerDay === null) return null;
    if (cpuP95 >= t.idleCpuP95 || cpuMax >= t.idleCpuMax || networkMbPerDay >= t.idleNetworkMbPerDay) {
      return null;
    }
    return {
      type: RecommendationType.EC2_IDLE,
      source: RecommendationSource.CCG_HEURISTIC,
      target: null,
      targetType: null,
      monthlySavings: currentCost,
      risk: Level.MEDIUM,
      confidence: this.coverageConfidence(analysis),
      reasons: [
        `CPU P95 ${cpuP95}% and max ${cpuMax}% over ${analysis.metrics.periodDays} days`,
        `Network ${networkMbPerDay} MB/day`,
        'Attached EBS volumes keep costing if the instance is only stopped',
      ],
    };
  }

  private optimizerCandidate(
    analysis: Ec2Analysis,
    input: Ec2AnalyzerInput,
    hasEnoughData: boolean,
  ): RecommendationCandidate | null {
    const rec = input.optimizer;
    if (!rec || rec.finding !== 'OVER_PROVISIONED') return null;
    const option = [...rec.options]
      .filter((o) => (o.estimatedMonthlySavings ?? 0) > 0)
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
      .find((o) => !this.violatesKubernetesFloor(analysis, o.spec));
    if (!option) return null;

    const reasons = [
      `AWS Compute Optimizer finding: over-provisioned (rank ${option.rank ?? '-'})`,
      ...this.kubernetesReasons(analysis),
    ];
    let risk = mapPerformanceRisk(option.performanceRisk);
    risk = this.applyMemoryRisk(analysis, option, risk, reasons);

    return {
      type: RecommendationType.EC2_RIGHTSIZING,
      source: RecommendationSource.COMPUTE_OPTIMIZER,
      target: option.spec,
      targetType: option.instanceType,
      monthlySavings: option.estimatedMonthlySavings,
      risk,
      confidence: hasEnoughData ? Level.HIGH : Level.MEDIUM,
      reasons,
    };
  }

  private applyMemoryRisk(
    analysis: Ec2Analysis,
    option: Ec2OptimizerOption,
    risk: Level,
    reasons: string[],
  ): Level {
    const currentMem = analysis.current.memoryGb;
    const shrinksMemory =
      option.spec !== null && currentMem !== null && option.spec.memoryGiB < currentMem;
    if (shrinksMemory && !analysis.metrics.memoryAvailable) {
      if (analysis.kubernetes) {
        reasons.push('Memory is reduced on a Kubernetes node without memory metrics: check pod memory requests (kubectl describe nodes)');
        return Level.HIGH;
      }
      reasons.push('Memory is reduced but memory metrics are unavailable (install CloudWatch Agent)');
      return maxLevel(risk, Level.MEDIUM);
    }
    return risk;
  }

  private heuristicCandidate(
    analysis: Ec2Analysis,
    input: Ec2AnalyzerInput,
    currentCost: number | null,
    hasEnoughData: boolean,
  ): RecommendationCandidate | null {
    const t = ANALYZER_THRESHOLDS;
    const target = input.downsizeCandidate;
    const { cpuP95, cpuMax, memoryAvailable, memoryP95 } = analysis.metrics;
    const curVcpu = analysis.current.vcpu;
    const curMem = analysis.current.memoryGb;
    if (input.optimizer?.finding === 'OPTIMIZED' || input.optimizer?.finding === 'UNDER_PROVISIONED') {
      return null;
    }
    if (!hasEnoughData || !target || curVcpu === null || curMem === null) return null;
    if (cpuP95 === null || cpuMax === null) return null;
    if (target.vcpu > curVcpu || (target.vcpu === curVcpu && target.memoryGiB >= curMem)) return null;
    if (cpuP95 >= t.heuristicCpuP95 || cpuMax >= t.heuristicCpuMax) return null;
    if (this.violatesKubernetesFloor(analysis, target)) return null;

    const projectedCpu = round((cpuP95 * curVcpu) / target.vcpu);
    if (projectedCpu >= t.projectedCpuP95Limit) return null;
    if ((analysis.metrics.cpuSurplusCreditsCharged ?? 0) > 0) return null;
    const baseline = burstableBaselinePercent(target.instanceType);
    const projectedAvg = analysis.metrics.cpuAverage === null ? null : round((analysis.metrics.cpuAverage * curVcpu) / target.vcpu);
    if (baseline !== null && projectedAvg !== null && projectedAvg > baseline) {
      analysis.metrics.notes.push(`${target.instanceType} baseline is ${baseline}% CPU; projected average ${projectedAvg}% would drain CPU credits`);
      return null;
    }

    const reasons = [
      `CPU P95 ${cpuP95}% (max ${cpuMax}%) over ${analysis.metrics.periodDays} days`,
      `Projected CPU P95 on ${target.instanceType}: ${projectedCpu}%`,
      ...(baseline !== null && projectedAvg !== null
        ? [`Projected average CPU ${projectedAvg}% stays below ${target.instanceType} baseline (${baseline}%): CPU credits stay positive`]
        : []),
    ];
    let risk = Level.LOW;
    let confidence = Level.MEDIUM;
    reasons.push(...this.kubernetesReasons(analysis));
    if (!memoryAvailable || memoryP95 === null) {
      risk = analysis.kubernetes && target.memoryGiB < curMem ? Level.HIGH : Level.MEDIUM;
      confidence = Level.LOW;
      reasons.push(
        analysis.kubernetes
          ? 'Memory metrics unavailable on a Kubernetes node: check pod memory requests (kubectl describe nodes) before resizing'
          : 'Memory metrics unavailable (install CloudWatch Agent)',
      );
    } else {
      const projectedMem = round((memoryP95 * curMem) / target.memoryGiB);
      if (projectedMem >= t.projectedMemoryP95Limit) return null;
      reasons.push(`Projected memory P95: ${projectedMem}%`);
    }

    if (currentCost === null) {
      confidence = Level.LOW;
      reasons.push('Monthly cost unavailable: enable Cost Explorer resource-level data or Compute Optimizer to estimate savings');
    }
    const currentPrice = input.onDemandMonthlyPrices[analysis.current.instanceType];
    const targetPrice = input.onDemandMonthlyPrices[target.instanceType];
    const priceRatio = currentPrice && targetPrice ? targetPrice / currentPrice : target.memoryGiB / curMem;
    if (analysis.current.costSource === 'ON_DEMAND_PRICE') {
      reasons.push('Savings estimated from on-demand prices; RI/Savings Plans discounts not considered');
    }
    return {
      type: RecommendationType.EC2_RIGHTSIZING,
      source: RecommendationSource.CCG_HEURISTIC,
      target,
      targetType: target.instanceType,
      monthlySavings: currentCost === null ? null : currentCost * (1 - priceRatio),
      risk,
      confidence,
      reasons,
    };
  }

  private coverageConfidence(analysis: Ec2Analysis): Level {
    const days = analysis.metrics.periodDays ?? 0;
    return days >= 14 ? Level.HIGH : Level.MEDIUM;
  }

  private toDraft(analysis: Ec2Analysis, c: RecommendationCandidate, currency: string): RecommendationDraft {
    const label = analysis.name ?? analysis.resourceId;
    const current = analysis.current;
    const monthly = c.monthlySavings === null ? null : round(c.monthlySavings);
    const isIdle = c.type === RecommendationType.EC2_IDLE;
    const title = isIdle
      ? `Idle EC2 instance ${label}`
      : `Rightsize ${label}: ${current.instanceType} to ${c.targetType}`;
    const savingsText = monthly === null ? 'savings unknown (cost data unavailable)' : `${currency} ${monthly}/month`;
    const description = isIdle
      ? `${label} (${current.instanceType}) shows almost no CPU or network activity. Consider stopping or terminating it. Estimated savings: ${savingsText}.`
      : `${label} can move from ${current.instanceType} to ${c.targetType}. Estimated savings: ${savingsText}.`;
    return {
      resourceId: analysis.resourceId,
      resourceArn: analysis.resourceArn,
      service: 'ec2',
      type: c.type,
      source: c.source,
      title,
      description,
      severity: severityFor(monthly),
      risk: c.risk,
      confidence: c.confidence,
      currentMonthlyCost: current.monthlyCost,
      recommendedMonthlyCost:
        current.monthlyCost !== null && monthly !== null ? round(current.monthlyCost - monthly) : null,
      estimatedMonthlySavings: monthly,
      estimatedYearlySavings: monthly === null ? null : round(monthly * 12),
      currency,
      targetKey: c.targetType ?? c.type,
      analysis,
    };
  }
}
