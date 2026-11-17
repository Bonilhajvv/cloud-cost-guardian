import { Injectable } from '@nestjs/common';
import { RecommendationDraft } from '../aws/core/interfaces/recommendation-draft.interface';
import { severityFor } from '../aws/ec2/helpers/risk-level.helper';
import { Level, RecommendationSource, RecommendationType } from '../common/enums';
import { round } from '../common/helpers/stats.helper';
import { HOURS_PER_WEEK } from '../organizations/constants/work-schedule.constant';
import { offHoursFraction, scheduleKey, scheduleWindow } from '../organizations/helpers/work-schedule.helper';
import {
  K8S_ANALYSIS,
  KARPENTER_POOL_LABEL,
  KUBERNETES_SERVICE,
  MAX_TITLE_LENGTH,
  MIN_K8S_SCHEDULE_MONTHLY_SAVINGS,
  SCALE_TO_ZERO_KINDS,
  SYSTEM_NAMESPACES,
} from './constants/kubernetes-analysis.constant';
import {
  formatCpu,
  formatMemory,
  namespaceResourceId,
  nodeGroupResourceId,
  perPod,
  roundUpTo,
  workloadResourceId,
} from './helpers/kubernetes-analysis.helper';
import {
  KubernetesAnalysis,
  KubernetesAnalyzerResult,
  KubernetesNamespaceAnalysis,
  KubernetesNodeGroupAnalysis,
  NamespaceAnalyzerInput,
  KubernetesWorkloadAnalysis,
  NodeGroupAnalyzerInput,
  ResourceAmount,
  SizingAction,
  UnitSizing,
  UsagePeak,
  WorkloadAnalyzerInput,
} from './interfaces/kubernetes-analysis.interface';

interface Unit {
  container: string | null;
  requests: ResourceAmount;
  limits: ResourceAmount;
  peak: ResourceAmount;
}

interface Sized {
  action: SizingAction;
  target: number;
}

type Resource = 'cpu' | 'memory';

interface Found {
  type: RecommendationType;
  title: string;
  reasons: string[];
  savings: number | null;
  current: number | null;
  risk: Level;
  severity?: Level;
  confidence: Level;
  targetKey: string;
}

const AMOUNT_KEY: Record<Resource, keyof ResourceAmount> = { cpu: 'cpuCores', memory: 'memoryBytes' };
const DECREASE: readonly SizingAction[] = ['DECREASE'];
const RAISE: readonly SizingAction[] = ['INCREASE', 'SET'];

@Injectable()
export class KubernetesAnalyzerService {
  analyzeWorkload(input: WorkloadAnalyzerInput): KubernetesAnalyzerResult {
    const { workload: w, peak } = input;
    const requests = { cpuCores: perPod(w.requestsCpu, w.podCount), memoryBytes: perPod(w.requestsMemoryBytes, w.podCount) };
    const label = `${w.kind} ${w.namespace}/${w.name}`;
    const units = this.units(input, requests);
    const analysis: KubernetesWorkloadAnalysis = {
      kind: 'KUBERNETES',
      scope: 'WORKLOAD',
      resourceId: workloadResourceId(input.clusterId, w.namespace, w.kind, w.name),
      resourceArn: null,
      name: label,
      clusterId: input.clusterId,
      clusterName: input.clusterName,
      environment: input.environment,
      finding: 'OPTIMIZED',
      current: {
        monthlyCost: null,
        namespace: w.namespace,
        workloadKind: w.kind,
        podCount: w.podCount,
        requestsPerPod: requests,
        peakPerPod: peak ? { cpuCores: peak.cpuCores, memoryBytes: peak.memoryBytes } : null,
        usageDays: units?.days ?? peak?.days ?? 0,
        basis: units?.basis ?? 'POD',
      },
      sizing: [],
      recommendedRequestsPerPod: null,
      recommendation: null,
      savings: null,
      analyzedAt: (input.now ?? new Date()).toISOString(),
    };
    if (!units) {
      analysis.finding = 'INSUFFICIENT_DATA';
      return { analysis, drafts: [] };
    }

    const sizing = units.list.map((u) => this.sizeUnit(u));
    for (const resource of ['cpu', 'memory'] as const) {
      const key = AMOUNT_KEY[resource];
      const freed = sizing.reduce((s, u) => s + (u[resource] === 'DECREASE' ? ((u.requests[key] ?? 0) - (u.recommended[key] ?? 0)) * w.podCount : 0), 0);
      const minFreed = resource === 'cpu' ? K8S_ANALYSIS.minFreedCpuCores : K8S_ANALYSIS.minFreedMemoryBytes;
      if (freed >= minFreed) continue;
      for (const u of sizing.filter((x) => x[resource] === 'DECREASE')) {
        u[resource] = null;
        u.recommended[key] = u.requests[key];
      }
    }
    analysis.sizing = sizing;
    const total = (key: keyof ResourceAmount) => (sizing.every((u) => u.recommended[key] !== null) ? sizing.reduce((s, u) => s + (u.recommended[key] as number), 0) : null);
    analysis.recommendedRequestsPerPod = { cpuCores: total('cpuCores') === null ? null : round(total('cpuCores') as number, 3), memoryBytes: total('memoryBytes') };

    const confidence = units.days >= K8S_ANALYSIS.windowDays ? Level.HIGH : Level.MEDIUM;
    const drafts = [this.decreaseDraft(input, analysis, label, units.days, confidence), this.raiseDraft(input, analysis, label, units.days, confidence)].filter(
      (d): d is NonNullable<typeof d> => d !== null,
    );
    analysis.finding = drafts.length === 0 ? 'OPTIMIZED' : drafts[0].analysis.finding;
    analysis.recommendation = drafts[0]?.analysis.recommendation ?? null;
    return { analysis, drafts };
  }

  private units(input: WorkloadAnalyzerInput, requestsPerPod: ResourceAmount): { basis: 'CONTAINER' | 'POD'; days: number; list: Unit[] } | null {
    const { workload: w, peak, containerPeaks } = input;
    const containers = w.containers ?? [];
    const peaks = containers.map((c) => containerPeaks.get(c.name));
    if (containers.length > 0 && peaks.every((p) => p !== undefined && p.days >= K8S_ANALYSIS.minUsageDays)) {
      return {
        basis: 'CONTAINER',
        days: Math.min(...peaks.map((p) => (p as UsagePeak).days)),
        list: containers.map((c, i) => ({ container: c.name, requests: c.requests, limits: c.limits, peak: { cpuCores: (peaks[i] as UsagePeak).cpuCores, memoryBytes: (peaks[i] as UsagePeak).memoryBytes } })),
      };
    }
    if (!peak || peak.days < K8S_ANALYSIS.minUsageDays) return null;
    return {
      basis: 'POD',
      days: peak.days,
      list: [{ container: null, requests: requestsPerPod, limits: { cpuCores: perPod(w.limitsCpu, w.podCount), memoryBytes: perPod(w.limitsMemoryBytes, w.podCount) }, peak: { cpuCores: peak.cpuCores, memoryBytes: peak.memoryBytes } }],
    };
  }

  private sizeUnit(u: Unit): UnitSizing {
    const cpu = this.size(u.requests.cpuCores, u.peak.cpuCores, K8S_ANALYSIS.cpuStepCores, K8S_ANALYSIS.cpuStepCores, K8S_ANALYSIS.minIncreaseCpuCores);
    const memory = this.size(u.requests.memoryBytes, u.peak.memoryBytes, K8S_ANALYSIS.memoryStepBytes, K8S_ANALYSIS.minMemoryBytes, K8S_ANALYSIS.minIncreaseMemoryBytes);
    return {
      container: u.container,
      requests: u.requests,
      limits: u.limits,
      peak: u.peak,
      recommended: { cpuCores: cpu ? round(cpu.target, 3) : u.requests.cpuCores, memoryBytes: memory ? memory.target : u.requests.memoryBytes },
      cpu: cpu?.action ?? null,
      memory: memory?.action ?? null,
    };
  }

  private size(request: number | null, peak: number | null, step: number, floor: number, minIncrease: number): Sized | null {
    if (peak === null) return null;
    const target = Math.max(floor, roundUpTo(peak * K8S_ANALYSIS.headroom, step));
    if (request === null || request <= 0) return { action: 'SET', target };
    if (peak > request && target - request >= minIncrease) return { action: 'INCREASE', target };
    if (peak <= request * K8S_ANALYSIS.maxPeakToRequest && target < request) return { action: 'DECREASE', target };
    return null;
  }

  private decreaseDraft(input: WorkloadAnalyzerInput, analysis: KubernetesWorkloadAnalysis, label: string, days: number, confidence: Level) {
    const units = this.affected(analysis.sizing, DECREASE);
    if (units.length === 0) return null;
    const pods = input.workload.podCount;
    const has = (r: Resource) => units.some((u) => u[r] === 'DECREASE');
    const freed = (key: keyof ResourceAmount) => units.reduce((s, u) => s + ((u.requests[key] ?? 0) - (u.recommended[key] ?? 0)) * pods, 0);
    const freedText = [has('cpu') ? `${formatCpu(freed('cpuCores'))} CPU` : null, has('memory') ? `${formatMemory(freed('memoryBytes'))} memory` : null].filter(Boolean).join(' and ');
    const changes = this.changes(units, DECREASE, analysis.current.basis);
    const found: Found = {
      type: RecommendationType.K8S_WORKLOAD_RIGHTSIZING,
      title: `Lower requests of ${label}: ${changes}`,
      reasons: [
        ...units.map((u) => this.peakLine(u, days)),
        `Set requests to the peak plus ${this.headroomPct()}%: ${changes}`,
        `Frees ${freedText} reserved on the nodes across ${pods} pod(s)`,
        'Requests reserve node capacity even when unused, so the savings come from running fewer nodes once pods are packed tighter (see the node consolidation recommendations)',
        ...(has('memory') ? ['Keep the memory limit above the peak: a container that exceeds its limit is OOMKilled'] : []),
        ...(has('cpu') && input.workload.hpa ? ['An HPA scales this workload: if it targets CPU utilization, lower CPU requests raise the measured utilization and add replicas, so adjust the target together'] : []),
      ],
      savings: null,
      current: null,
      risk: has('memory') ? Level.MEDIUM : Level.LOW,
      confidence,
      targetKey: this.targetKey(units, DECREASE),
    };
    return this.draft({ ...analysis, finding: 'OVER_PROVISIONED' }, found, input.currency, 'savings depend on node consolidation');
  }

  private raiseDraft(input: WorkloadAnalyzerInput, analysis: KubernetesWorkloadAnalysis, label: string, days: number, confidence: Level) {
    const units = this.affected(analysis.sizing, RAISE);
    if (units.length === 0) return null;
    const is = (r: Resource, action: SizingAction) => units.some((u) => u[r] === action);
    const raises = (r: Resource) => is(r, 'INCREASE') || is(r, 'SET');
    const allSet = units.every((u) => (u.cpu === null || u.cpu === 'SET') && (u.memory === null || u.memory === 'SET'));
    const changes = this.changes(units, RAISE, analysis.current.basis);
    const limitLines = units.flatMap((u) =>
      (['cpu', 'memory'] as const).flatMap((r) => {
        const key = AMOUNT_KEY[r];
        const limit = u.limits[key];
        const target = u.recommended[key];
        if (!u[r] || !RAISE.includes(u[r] as SizingAction) || !limit || target === null || target <= limit) return [];
        const fmt = r === 'cpu' ? formatCpu : formatMemory;
        return [`${this.unitName(u)}: the ${r === 'cpu' ? 'CPU' : 'memory'} limit ${fmt(limit)} is below the new request; Kubernetes rejects a request above the limit, so raise the limit to at least ${fmt(target)}`];
      }),
    );
    const found: Found = {
      type: RecommendationType.K8S_WORKLOAD_UNDERSIZED,
      title: `${allSet ? 'Set' : 'Raise'} requests of ${label}: ${changes}`,
      reasons: [
        ...units.map((u) => this.peakLine(u, days)),
        `Set requests to the peak plus ${this.headroomPct()}%: ${changes}`,
        ...(is('cpu', 'SET') || is('memory', 'SET')
          ? ['Without a request the scheduler counts the container as using nothing, so nodes get overcommitted; a pod with no requests at all is BestEffort and is the first evicted when a node runs short of memory']
          : []),
        ...(is('memory', 'INCREASE') ? ['Memory use above the request puts the pod among the first evicted when the node runs short of memory'] : []),
        ...(is('cpu', 'INCREASE') ? ['CPU use above the request only works while the node has idle CPU; under contention the container gets its share and slows down'] : []),
        ...limitLines,
        ...(raises('cpu') && input.workload.hpa ? ['An HPA scales this workload: if it targets CPU utilization, higher CPU requests lower the measured utilization and remove replicas, so adjust the target together'] : []),
        'Higher requests can need more nodes: the cluster cost may grow in exchange for fewer evictions and less throttling',
      ],
      savings: null,
      current: null,
      risk: Level.LOW,
      severity: raises('memory') ? Level.MEDIUM : Level.LOW,
      confidence,
      targetKey: this.targetKey(units, RAISE),
    };
    return this.draft({ ...analysis, finding: 'UNDER_PROVISIONED' }, found, input.currency, 'none, this improves stability and may add cost');
  }

  private affected(sizing: UnitSizing[], actions: readonly SizingAction[]): UnitSizing[] {
    return sizing.filter((u) => (u.cpu !== null && actions.includes(u.cpu)) || (u.memory !== null && actions.includes(u.memory)));
  }

  private changes(units: UnitSizing[], actions: readonly SizingAction[], basis: 'CONTAINER' | 'POD'): string {
    const text = units
      .map((u) => {
        const parts = (['cpu', 'memory'] as const)
          .filter((r) => u[r] !== null && actions.includes(u[r] as SizingAction))
          .map((r) => {
            const key = AMOUNT_KEY[r];
            const fmt = r === 'cpu' ? formatCpu : formatMemory;
            const from = u[r] === 'SET' ? 'unset' : fmt(u.requests[key]);
            return `${r === 'cpu' ? 'CPU' : 'memory'} ${from} to ${fmt(u.recommended[key])}`;
          });
        return `${u.container ? `${u.container} ` : ''}${parts.join(', ')}`;
      })
      .join('; ');
    return basis === 'POD' ? `${text} per pod` : text;
  }

  private targetKey(units: UnitSizing[], actions: readonly SizingAction[]): string {
    return units
      .map((u) => {
        const resources = (['cpu', 'memory'] as const).filter((r) => u[r] !== null && actions.includes(u[r] as SizingAction)).map((r) => r.toUpperCase());
        return `${u.container ? `${u.container}:` : ''}${resources.join('+')}`;
      })
      .join(';');
  }

  private peakLine(u: UnitSizing, days: number): string {
    const requested = (v: number | null, fmt: (x: number | null) => string) => (v === null || v <= 0 ? 'no request' : `${fmt(v)} requested`);
    const who = u.container ? `container ${u.container} (busiest pod)` : 'per pod';
    return `Peak usage ${who} over ${days} days: CPU ${formatCpu(u.peak.cpuCores)} (${requested(u.requests.cpuCores, formatCpu)}), memory ${formatMemory(u.peak.memoryBytes)} (${requested(u.requests.memoryBytes, formatMemory)})`;
  }

  private unitName(u: UnitSizing): string {
    return u.container ? `Container ${u.container}` : 'Pod';
  }

  private headroomPct(): number {
    return Math.round((K8S_ANALYSIS.headroom - 1) * 100);
  }

  analyzeNodeGroup(input: NodeGroupAnalyzerInput): KubernetesAnalyzerResult {
    const { nodes, pool, instanceType } = input;
    const count = nodes.length;
    const known = (values: (number | null)[]): number[] | null => (values.every((v) => v !== null) ? (values as number[]) : null);
    const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);
    const costs = known(nodes.map((n) => n.monthlyCost));
    const allocCpu = known(nodes.map((n) => n.allocatableCpu));
    const allocMemory = known(nodes.map((n) => n.allocatableMemoryBytes));
    const peakCpu = known(nodes.map((n) => n.peakRequests.cpuCores));
    const peakMemory = known(nodes.map((n) => n.peakRequests.memoryBytes));
    const days = Math.min(...nodes.map((n) => n.peakRequests.days));
    const groupName = pool?.value ?? instanceType ?? 'node group';
    const analysis: KubernetesNodeGroupAnalysis = {
      kind: 'KUBERNETES',
      scope: 'NODE_GROUP',
      resourceId: nodeGroupResourceId(input.clusterId, pool, instanceType),
      resourceArn: null,
      name: `${input.clusterName} ${groupName}`,
      clusterId: input.clusterId,
      clusterName: input.clusterName,
      environment: input.environment,
      finding: 'OPTIMIZED',
      current: {
        monthlyCost: costs ? round(sum(costs)) : null,
        pool,
        instanceType,
        nodes: count,
        allocatablePerNode: { cpuCores: allocCpu ? Math.min(...allocCpu) : null, memoryBytes: allocMemory ? Math.min(...allocMemory) : null },
        peakRequests: { cpuCores: peakCpu ? round(sum(peakCpu), 3) : null, memoryBytes: peakMemory ? sum(peakMemory) : null },
        usageDays: days,
      },
      recommendedNodes: null,
      recommendation: null,
      savings: null,
      analyzedAt: (input.now ?? new Date()).toISOString(),
    };
    if (count === 0 || !allocCpu || !allocMemory || !peakCpu || !peakMemory || days < K8S_ANALYSIS.minUsageDays) {
      analysis.finding = 'INSUFFICIENT_DATA';
      return this.withSchedule(analysis, input, []);
    }

    const capCpu = Math.min(...allocCpu) * K8S_ANALYSIS.nodeTargetFill;
    const capMemory = Math.min(...allocMemory) * K8S_ANALYSIS.nodeTargetFill;
    if (capCpu <= 0 || capMemory <= 0) return this.withSchedule(analysis, input, []);
    const totalCpu = sum(peakCpu);
    const totalMemory = sum(peakMemory);
    const needed = Math.max(1, Math.ceil(totalCpu / capCpu - 1e-9), Math.ceil(totalMemory / capMemory - 1e-9)) + K8S_ANALYSIS.spareNodes;
    const removable = count - needed;
    if (removable <= 0) return this.withSchedule(analysis, input, []);

    analysis.finding = 'OVER_PROVISIONED';
    analysis.recommendedNodes = needed;
    const savings = costs ? round(sum([...costs].sort((a, b) => a - b).slice(0, removable))) : null;
    const pct = (used: number, alloc: number[]) => Math.round((used / sum(alloc)) * 100);
    const found: Found = {
      type: RecommendationType.K8S_NODE_CONSOLIDATION,
      title: `Remove ${removable} of ${count} nodes from ${groupName} in cluster ${input.clusterName}`,
      reasons: [
        `${count} ${instanceType ? `${instanceType} ` : ''}nodes: peak pod requests over ${days} days were ${formatCpu(totalCpu)} CPU (${pct(totalCpu, allocCpu)}% of allocatable) and ${formatMemory(totalMemory)} memory (${pct(totalMemory, allocMemory)}% of allocatable)`,
        `${needed} nodes hold the same requests at ${Math.round(K8S_ANALYSIS.nodeTargetFill * 100)}% fill, plus ${K8S_ANALYSIS.spareNodes} spare node for failures and rollouts; DaemonSet pods are counted as if they did not shrink with the node count`,
        savings === null ? `Removing ${removable} node(s) saves their EC2 cost, but the price of some nodes is unknown` : `Removing the ${removable} cheapest node(s) saves their EC2 cost`,
        pool?.label === KARPENTER_POOL_LABEL
          ? 'Karpenter manages these nodes: enable consolidation in the NodePool (consolidationPolicy: WhenEmptyOrUnderutilized)'
          : 'Lower the desired and minimum size of the node group, or let the cluster autoscaler remove the nodes',
        'Check PodDisruptionBudgets, topology spread constraints and pods with local storage before draining nodes',
      ],
      savings,
      current: analysis.current.monthlyCost,
      risk: Level.MEDIUM,
      confidence: days >= K8S_ANALYSIS.windowDays ? Level.HIGH : Level.MEDIUM,
      targetKey: `NODES=${needed}`,
    };
    return this.withSchedule(analysis, input, [this.draft(analysis, found, input.currency, 'savings unknown')]);
  }

  analyzeNamespace(input: NamespaceAnalyzerInput): KubernetesAnalyzerResult {
    const workloads = input.workloads.filter((w) => SCALE_TO_ZERO_KINDS.includes(w.kind) && w.podCount > 0);
    const requests = {
      cpuCores: round(workloads.reduce((s, w) => s + (w.requestsCpu ?? 0), 0), 3),
      memoryBytes: workloads.reduce((s, w) => s + (w.requestsMemoryBytes ?? 0), 0),
    };
    const analysis: KubernetesNamespaceAnalysis = {
      kind: 'KUBERNETES',
      scope: 'NAMESPACE',
      resourceId: namespaceResourceId(input.clusterId, input.namespace),
      resourceArn: null,
      name: `${input.clusterName} ${input.namespace}`,
      clusterId: input.clusterId,
      clusterName: input.clusterName,
      environment: input.environment,
      finding: 'OPTIMIZED',
      current: { monthlyCost: null, namespace: input.namespace, workloads: workloads.length, pods: workloads.reduce((s, w) => s + w.podCount, 0), requests },
      recommendation: null,
      savings: null,
      analyzedAt: (input.now ?? new Date()).toISOString(),
    };
    const off = offHoursFraction(input.schedule);
    const enough = requests.cpuCores >= K8S_ANALYSIS.minFreedCpuCores || requests.memoryBytes >= K8S_ANALYSIS.minFreedMemoryBytes;
    if (input.environment.environment !== 'NON_PRODUCTION' || SYSTEM_NAMESPACES.includes(input.namespace) || off <= 0 || !enough) return { analysis, drafts: [] };
    const window = scheduleWindow(input.schedule);
    const found: Found = {
      type: RecommendationType.K8S_NAMESPACE_SCHEDULE,
      title: `Scale namespace ${input.namespace} to zero outside business hours in cluster ${input.clusterName} (${window})`,
      reasons: [
        `Non-production namespace (${input.environment.detail})`,
        `${workloads.length} Deployment(s) and StatefulSet(s) with ${analysis.current.pods} pod(s) reserve ${formatCpu(requests.cpuCores)} CPU and ${formatMemory(requests.memoryBytes)} memory`,
        `Outside ${window} (${input.schedule.timezone}) is ${Math.round(off * 100)}% of the week: scaling to zero frees these requests so the cluster autoscaler or Karpenter can remove nodes`,
        'Use kube-downscaler (downscaler/uptime annotation on the namespace) or a KEDA cron scaler; DaemonSets keep running',
        'StatefulSets keep their volumes; check jobs, consumers and pipelines that must run at night',
      ],
      savings: null,
      current: null,
      risk: Level.LOW,
      confidence: input.environment.source === 'NAME' ? Level.MEDIUM : Level.HIGH,
      targetKey: scheduleKey(input.schedule),
    };
    return { analysis, drafts: [this.draft({ ...analysis, finding: 'OFF_HOURS' }, found, input.currency, 'savings come from the nodes the cluster removes')] };
  }

  private withSchedule(analysis: KubernetesNodeGroupAnalysis, input: NodeGroupAnalyzerInput, drafts: RecommendationDraft[]): KubernetesAnalyzerResult {
    const off = offHoursFraction(input.schedule);
    if (input.environment.environment !== 'NON_PRODUCTION' || off <= 0 || input.nodes.length === 0) return { analysis, drafts };
    const monthly = analysis.current.monthlyCost;
    const savings = monthly === null ? null : round(monthly * off);
    if (savings !== null && savings < MIN_K8S_SCHEDULE_MONTHLY_SAVINGS) return { analysis, drafts };
    const window = scheduleWindow(input.schedule);
    const groupName = input.pool?.value ?? input.instanceType ?? 'node group';
    const found: Found = {
      type: RecommendationType.K8S_NODE_GROUP_SCHEDULE,
      title: `Scale node group ${groupName} in cluster ${input.clusterName} to zero outside business hours (${window})`,
      reasons: [
        `Non-production nodes (${input.environment.detail})`,
        `Running only ${window} (${input.schedule.timezone}) is ${input.schedule.hoursPerWeek}h of ${HOURS_PER_WEEK}h per week, about ${Math.round(off * 100)}% less for ${input.nodes.length} node(s)`,
        input.pool?.label === KARPENTER_POOL_LABEL
          ? 'Karpenter removes the nodes once the pods are gone: scale the workloads to zero off-hours (kube-downscaler or KEDA cron) and keep consolidation on'
          : 'Add scheduled actions to the node group Auto Scaling group (desired and minimum 0 at night, back in the morning) and scale the workloads to zero first (kube-downscaler or KEDA cron)',
        'Pods on these nodes stop outside business hours; StatefulSet volumes stay, and the first pods take a few minutes to start in the morning',
        'If a Reserved Instance or Savings Plan covers these nodes, stopping them saves nothing until the commitment ends',
      ],
      savings,
      current: monthly,
      risk: Level.LOW,
      confidence: input.environment.source === 'NAME' ? Level.MEDIUM : Level.HIGH,
      targetKey: scheduleKey(input.schedule),
    };
    return { analysis, drafts: [...drafts, this.draft({ ...analysis, finding: 'OFF_HOURS', recommendation: null, savings: null }, found, input.currency, 'unknown, some node prices are unavailable')] };
  }

  private draft<T extends KubernetesAnalysis>(analysis: T, found: Found, currency: string, unknownSavings: string): RecommendationDraft & { analysis: T } {
    analysis.recommendation = { type: found.type, source: RecommendationSource.CCG_HEURISTIC, performanceRisk: found.risk, confidence: found.confidence, reasons: found.reasons };
    if (found.savings !== null) analysis.savings = { monthly: found.savings, yearly: round(found.savings * 12), currency };
    const savingsText = found.savings === null ? unknownSavings : `${currency} ${found.savings}/month`;
    return {
      resourceId: analysis.resourceId,
      resourceArn: null,
      service: KUBERNETES_SERVICE,
      type: found.type,
      source: RecommendationSource.CCG_HEURISTIC,
      title: found.title.slice(0, MAX_TITLE_LENGTH),
      description: `${found.reasons.join('. ')}. Estimated savings: ${savingsText}.`,
      severity: found.severity ?? severityFor(found.savings),
      risk: found.risk,
      confidence: found.confidence,
      currentMonthlyCost: found.current,
      recommendedMonthlyCost: found.current !== null && found.savings !== null ? round(Math.max(0, found.current - found.savings)) : null,
      estimatedMonthlySavings: found.savings,
      estimatedYearlySavings: found.savings === null ? null : round(found.savings * 12),
      currency,
      targetKey: found.targetKey,
      analysis,
    };
  }
}
