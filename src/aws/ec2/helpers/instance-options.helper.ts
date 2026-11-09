import { round } from '../../../common/helpers/stats.helper';
import { K8S_MIN_MEMORY_GIB } from '../constants/kubernetes.constant';
import { OPTION_FIT_THRESHOLDS } from '../constants/instance-options.constant';
import { Ec2Analysis } from '../interfaces/ec2-analysis.interface';
import { InstanceTypeSpec } from '../interfaces/ec2-instance.interface';
import { InstanceOption, OptionFit, OptionKind, UsageProfile } from '../interfaces/usage-profile.interface';
import { burstableBaselinePercent } from './burstable.helper';

const FIT_ORDER: OptionFit[] = ['FITS', 'UNKNOWN', 'TIGHT', 'DOES_NOT_FIT'];

function worst(a: OptionFit, b: OptionFit): OptionFit {
  return FIT_ORDER.indexOf(a) >= FIT_ORDER.indexOf(b) ? a : b;
}

export interface OptionCandidate {
  spec: InstanceTypeSpec;
  kind: OptionKind;
  savingsHint?: number | null;
}

export function buildInstanceOption(
  analysis: Pick<Ec2Analysis, 'current' | 'kubernetes'>,
  usage: UsageProfile,
  candidate: OptionCandidate,
  prices: Record<string, number>,
  currentArchitectures: string[],
  currentSpec?: InstanceTypeSpec,
): InstanceOption {
  const t = OPTION_FIT_THRESHOLDS;
  const { spec, kind } = candidate;
  const curVcpu = analysis.current.vcpu;
  const curMem = analysis.current.memoryGb;
  const notes: string[] = [];
  let fit: OptionFit = 'FITS';

  const cpuScale = curVcpu ? curVcpu / spec.vcpu : null;
  const cpuP95 = cpuScale !== null && usage.cpu.p95 !== null ? round(usage.cpu.p95 * cpuScale) : null;
  const cpuMax = cpuScale !== null && usage.cpu.max !== null ? round(Math.min(usage.cpu.max * cpuScale, 100)) : null;
  const cpuAvg = cpuScale !== null && usage.cpu.average !== null ? round(usage.cpu.average * cpuScale) : null;
  if (cpuP95 === null) fit = worst(fit, 'UNKNOWN');
  else if (cpuP95 >= t.cpuP95Tight) fit = worst(fit, 'DOES_NOT_FIT');
  else if (cpuP95 >= t.cpuP95Fits || (cpuMax ?? 0) >= t.cpuMaxFits) fit = worst(fit, 'TIGHT');
  if (cpuMax !== null && usage.cpu.max !== null && cpuScale !== null && usage.cpu.max * cpuScale > 100) {
    notes.push('Observed CPU peaks would saturate this type');
  }

  const baseline = burstableBaselinePercent(spec.instanceType);
  if (baseline !== null && cpuAvg !== null && cpuAvg > baseline) {
    fit = worst(fit, 'TIGHT');
    notes.push(`Projected average CPU ${cpuAvg}% above burstable baseline ${baseline}%: drains CPU credits`);
  }

  let memoryP95: number | null = null;
  let memoryPeakGb: number | null = null;
  if (usage.memory.available && usage.memory.p95GbUsed !== null) {
    memoryP95 = round((usage.memory.p95GbUsed / spec.memoryGiB) * 100);
    memoryPeakGb = usage.memory.peakGbUsed;
    if (memoryP95 >= t.memoryP95Tight) fit = worst(fit, 'DOES_NOT_FIT');
    else if (memoryP95 >= t.memoryP95Fits) fit = worst(fit, 'TIGHT');
  } else if (curMem !== null && spec.memoryGiB < curMem) {
    fit = worst(fit, 'UNKNOWN');
    notes.push('Less memory than today and memory usage is not measured');
  }

  const node = analysis.kubernetes;
  if (node && spec.memoryGiB < K8S_MIN_MEMORY_GIB[node.role]) {
    fit = 'DOES_NOT_FIT';
    notes.push(`Kubernetes ${node.role === 'CONTROL_PLANE' ? 'control plane' : 'worker'} needs at least ${K8S_MIN_MEMORY_GIB[node.role]} GiB`);
  }

  if (kind !== 'CURRENT') {
    for (const [field, label] of [['accelerators', 'GPU/accelerators'], ['localStorageGb', 'local instance storage GB']] as const) {
      const have = currentSpec?.[field];
      if (!have) continue;
      const offered = spec[field];
      if (offered === undefined) {
        fit = worst(fit, 'UNKNOWN');
        notes.push(`${label} of this type unknown (current: ${have})`);
      } else if (offered < have) {
        fit = 'DOES_NOT_FIT';
        notes.push(`Loses ${label}: ${offered} vs ${have} today`);
      }
    }
  }

  if (spec.architectures.length && currentArchitectures.length && !spec.architectures.some((a) => currentArchitectures.includes(a))) {
    notes.push(`Different CPU architecture (${spec.architectures.join('/')}): images and binaries must support it`);
  }

  const optionPrice = prices[spec.instanceType];
  const currentPrice = prices[analysis.current.instanceType];
  const currentCost = analysis.current.monthlyCost;
  let monthlyCost: number | null = null;
  if (kind === 'CURRENT') monthlyCost = currentCost;
  else if (currentCost !== null && optionPrice !== undefined && currentPrice) monthlyCost = round(currentCost * (optionPrice / currentPrice));
  else if (optionPrice !== undefined) monthlyCost = optionPrice;
  else if (currentCost !== null && candidate.savingsHint) monthlyCost = round(currentCost - candidate.savingsHint);
  if (monthlyCost === null && kind !== 'CURRENT') notes.push('Price unavailable');

  return {
    instanceType: spec.instanceType,
    kind,
    vcpu: spec.vcpu,
    memoryGb: spec.memoryGiB,
    architectures: spec.architectures,
    monthlyCost,
    monthlySavings: kind === 'CURRENT' || monthlyCost === null || currentCost === null ? null : round(currentCost - monthlyCost),
    projected: { cpuP95, cpuMax, memoryP95, memoryPeakGb },
    fit: kind === 'CURRENT' ? worst('FITS', fit === 'UNKNOWN' ? 'FITS' : fit) : fit,
    notes,
  };
}
