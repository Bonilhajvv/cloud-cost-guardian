import { ResourceAnalysis } from '../../aws/core/interfaces/recommendation-draft.interface';
import { OptionFit } from '../../aws/ec2/interfaces/usage-profile.interface';
import { RecommendationType } from '../../common/enums';
import { round } from '../../common/helpers/stats.helper';
import { REMOVAL_TYPES } from '../constants/recommendation.constant';
import {
  RealizedSource,
  RecommendationResolution,
  ResolutionOutcome,
  ResourceChange,
  SizeDirection,
} from '../interfaces/recommendation-metadata.interface';

function configuredType(analysis: ResourceAnalysis): string {
  return analysis.kind === 'EBS' ? analysis.current.volumeType : analysis.current.instanceType;
}

function recommendedType(analysis: ResourceAnalysis): string | null {
  if (!analysis.recommendation) return null;
  return analysis.kind === 'EBS' ? analysis.recommendation.targetVolumeType : analysis.recommendation.instanceType;
}

function sizeOf(analysis: ResourceAnalysis): (number | null)[] {
  return analysis.kind === 'EBS' ? [analysis.current.sizeGiB] : [analysis.current.vcpu, analysis.current.memoryGb];
}

function recommendedSizeOf(analysis: ResourceAnalysis): (number | null)[] | null {
  if (analysis.kind === 'EBS') return analysis.recommendation ? [analysis.current.sizeGiB] : null;
  return analysis.recommendation ? [analysis.recommendation.vcpu, analysis.recommendation.memoryGb] : null;
}

function currentFit(analysis: ResourceAnalysis): OptionFit | null {
  if (analysis.kind === 'EBS') return null;
  return analysis.options?.find((o) => o.kind === 'CURRENT')?.fit ?? null;
}

function sizeDirection(before: (number | null)[], after: (number | null)[]): SizeDirection {
  if ([...before, ...after].some((v) => v === null || v === undefined)) return 'UNKNOWN';
  const diffs = before.map((b, i) => Math.sign((after[i] as number) - (b as number)));
  if (diffs.every((d) => d === 0)) return 'SAME_SIZE';
  if (diffs.every((d) => d <= 0)) return 'SMALLER';
  if (diffs.every((d) => d >= 0)) return 'LARGER';
  return 'MIXED';
}

export function typeChanged(previous: ResourceAnalysis | undefined, current: ResourceAnalysis): boolean {
  return !!previous && previous.kind === current.kind && configuredType(previous) !== configuredType(current);
}

function changeResolution(previous: ResourceAnalysis, current: ResourceAnalysis): RecommendationResolution {
  const change: ResourceChange = {
    from: configuredType(previous),
    to: configuredType(current),
    recommended: recommendedType(previous),
    size: sizeDirection(sizeOf(previous), sizeOf(current)),
    comparedToRecommended: sizeDirection(recommendedSizeOf(previous) ?? [null], sizeOf(current)),
    currentFit: currentFit(current),
    monthlyCostFrom: previous.current.monthlyCost,
    monthlyCostTo: current.current.monthlyCost,
  };
  const applied = change.recommended === change.to;
  const label = (d: string) => d.toLowerCase().replaceAll('_', ' ');
  const parts = [
    applied
      ? `Changed from ${change.from} to ${change.to} as recommended`
      : `Changed from ${change.from} to ${change.to} (${label(change.size)}), recommended was ${change.recommended ?? 'none'} (new type is ${label(change.comparedToRecommended)} than recommended)`,
    change.currentFit === 'DOES_NOT_FIT' || change.currentFit === 'TIGHT' ? `current usage ${label(change.currentFit)} on ${change.to}` : null,
  ];
  return { reason: applied ? 'APPLIED' : 'CHANGED_DIFFERENTLY', finding: current.finding, detail: parts.filter(Boolean).join('; '), change };
}

export function resolutionFor(previous: ResourceAnalysis | undefined, current: ResourceAnalysis | undefined): RecommendationResolution {
  if (!current) return { reason: 'RESOURCE_REMOVED', finding: null, detail: 'Resource no longer found in the latest scan' };
  const finding = current.finding;
  if (previous && typeChanged(previous, current)) return changeResolution(previous, current);
  if (current.kind === 'EBS') return { reason: 'NO_LONGER_RECOMMENDED', finding, detail: `Latest analysis finding: ${finding}` };

  if (finding === 'NOT_RUNNING') return { reason: 'NOT_RUNNING', finding, detail: 'Instance is not running' };
  if (finding === 'INSUFFICIENT_DATA') return { reason: 'INSUFFICIENT_DATA', finding, detail: 'Not enough metrics to keep the recommendation' };

  const target = previous ? recommendedType(previous) : null;
  const option = target ? current.options?.find((o) => o.instanceType === target) : undefined;
  if (option?.fit === 'DOES_NOT_FIT') {
    const parts = [
      `${target} does not fit current usage`,
      option.projected.memoryP95 !== null ? `projected memory P95 ${option.projected.memoryP95}%` : null,
      option.projected.cpuP95 !== null ? `projected CPU P95 ${option.projected.cpuP95}%` : null,
      ...option.notes,
    ];
    return { reason: 'DOES_NOT_FIT', finding, detail: parts.filter(Boolean).join('; ') };
  }
  return { reason: 'NO_LONGER_RECOMMENDED', finding, detail: `Latest analysis finding: ${finding}` };
}

function onDemandMonthly(analysis: ResourceAnalysis): number | null {
  if (analysis.kind === 'EBS') return analysis.current.monthlyCost;
  const fromOption = analysis.options?.find((o) => o.kind === 'CURRENT')?.monthlyCost;
  if (fromOption !== undefined && fromOption !== null) return fromOption;
  return analysis.current.costSource === 'ON_DEMAND_PRICE' ? analysis.current.monthlyCost : null;
}

function removedResourceSavings(
  type: RecommendationType,
  previous: ResourceAnalysis | undefined,
  recCurrentMonthlyCost: number | null,
  isPresent: (resourceId: string) => boolean,
): ResolutionOutcome['realized'] {
  if (type !== RecommendationType.EC2_STOPPED) {
    return recCurrentMonthlyCost !== null && recCurrentMonthlyCost > 0 ? { amount: recCurrentMonthlyCost, source: 'RESOURCE_COST' } : null;
  }
  const volumes = previous && previous.kind !== 'EBS' ? previous.stoppedVolumes : undefined;
  if (!volumes) return null;
  const removed = volumes.filter((v) => !isPresent(v.volumeId));
  if (removed.some((v) => v.monthlyCost === null)) return null;
  const amount = round(removed.reduce((sum, v) => sum + (v.monthlyCost as number), 0));
  return amount > 0 ? { amount, source: 'RESOURCE_COST' } : null;
}

export function resolutionOutcome(
  type: RecommendationType,
  previous: ResourceAnalysis | undefined,
  current: ResourceAnalysis | undefined,
  resolution: RecommendationResolution,
  recCurrentMonthlyCost: number | null,
  isPresent: (resourceId: string) => boolean = () => false,
): ResolutionOutcome {
  const none: ResolutionOutcome = { implemented: false, realized: null };
  if (resolution.reason === 'RESOURCE_REMOVED') {
    if (!REMOVAL_TYPES.includes(type)) return none;
    return { implemented: true, realized: removedResourceSavings(type, previous, recCurrentMonthlyCost, isPresent) };
  }
  if (!previous || !current || !resolution.change) return none;
  const from = onDemandMonthly(previous);
  const to = onDemandMonthly(current);
  const amount = from !== null && to !== null ? round(from - to) : null;
  const realized =
    type !== RecommendationType.EC2_UPSIZE && amount !== null && amount > 0 ? { amount, source: 'ON_DEMAND_PRICE' as RealizedSource } : null;
  if (resolution.reason === 'APPLIED') return { implemented: true, realized };
  const fits = resolution.change.currentFit === null ? current.kind === 'EBS' : resolution.change.currentFit === 'FITS' || resolution.change.currentFit === 'TIGHT';
  if (realized && fits) return { implemented: true, realized };
  return none;
}
