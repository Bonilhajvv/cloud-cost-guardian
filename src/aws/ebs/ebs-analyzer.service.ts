import { Injectable } from '@nestjs/common';
import { Level, RecommendationSource, RecommendationType } from '../../common/enums';
import { round } from '../../common/helpers/stats.helper';
import { RecommendationDraft } from '../core/interfaces/recommendation-draft.interface';
import { severityFor } from '../ec2/helpers/risk-level.helper';
import {
  DAY_MS,
  EXPAND_TARGET_USED_PERCENT,
  EXPAND_TRIGGER_USED_PERCENT,
  GP3_BASELINE_IOPS,
  GP3_BASELINE_THROUGHPUT_MBPS,
  GP3_LIMITS,
  IO_VOLUME_TYPES,
  MIN_EBS_DATAPOINTS,
  PERFORMANCE_HEADROOM,
  RECENT_VOLUME_DAYS,
} from './constants/ebs.constant';
import { provisionedPerformanceCost, volumeMonthlyCost } from './helpers/ebs-cost.helper';
import { EbsAnalysis, EbsAnalyzerInput, EbsAnalyzerResult as AnalyzerResult, EbsDraftText as DraftText } from './interfaces/ebs-analysis.interface';

@Injectable()
export class EbsAnalyzerService {
  analyze(input: EbsAnalyzerInput): AnalyzerResult {
    const { volume, metrics, pricePerGbMonth } = input;
    const now = input.now ?? new Date();
    const unitPrice = pricePerGbMonth[volume.volumeType];
    const storageCost = unitPrice === undefined ? null : volume.sizeGiB * unitPrice;
    const totalCost = volumeMonthlyCost(volume, pricePerGbMonth, input.performancePrices);
    const monthlyCost = totalCost ?? storageCost;
    const hasMetrics = (metrics?.datapoints ?? 0) >= MIN_EBS_DATAPOINTS;
    const notes: string[] = [];
    if (monthlyCost === null) notes.push('Storage price unavailable');
    if (storageCost !== null && totalCost === null) notes.push('Provisioned IOPS/throughput cost not included in monthly cost');
    if (!hasMetrics && volume.state === 'in-use') notes.push('Not enough EBS metrics to evaluate performance');

    const analysis: EbsAnalysis = {
      kind: 'EBS',
      resourceId: volume.volumeId,
      resourceArn: volume.arn,
      name: volume.name,
      region: volume.region,
      finding: 'OPTIMIZED',
      current: {
        volumeType: volume.volumeType,
        sizeGiB: volume.sizeGiB,
        iops: volume.iops,
        throughputMBps: volume.throughputMBps,
        monthlyCost: monthlyCost === null ? null : round(monthlyCost),
        attachedTo: volume.attachedInstanceIds,
      },
      metrics: {
        avgIops: metrics?.avgIops ?? null,
        peakIops: metrics?.peakIops ?? null,
        peakThroughputMBps: metrics?.peakThroughputMBps ?? null,
        burstBalanceMin: metrics?.burstBalanceMin ?? null,
        diskP95UsedPercent: input.instanceDisk?.p95UsedPercent ?? null,
        notes,
      },
      recommendation: null,
      savings: null,
      analyzedAt: now.toISOString(),
    };

    if (volume.state === 'available') return this.unattached(analysis, input, now, monthlyCost);
    if (volume.state !== 'in-use') return { analysis, draft: null };
    if (input.attachedToStoppedInstance) {
      notes.push('Attached instance is stopped: see the stopped instance recommendation');
      return { analysis, draft: null };
    }
    return (
      this.expand(analysis, input, unitPrice) ??
      this.gp2ToGp3(analysis, input, hasMetrics, unitPrice) ??
      this.reduceProvisioned(analysis, input, hasMetrics) ??
      this.ioToGp3(analysis, input, hasMetrics, totalCost) ?? { analysis, draft: null }
    );
  }

  private unattached(analysis: EbsAnalysis, input: EbsAnalyzerInput, now: Date, monthlyCost: number | null): AnalyzerResult {
    const { volume, currency } = input;
    const ageDays = volume.createTime ? (now.getTime() - Date.parse(volume.createTime)) / DAY_MS : null;
    const recent = ageDays !== null && ageDays < RECENT_VOLUME_DAYS;
    analysis.finding = 'UNATTACHED';
    analysis.recommendation = {
      type: RecommendationType.EBS_UNUSED,
      source: RecommendationSource.CCG_HEURISTIC,
      action: 'SNAPSHOT_AND_DELETE',
      targetVolumeType: null,
      performanceRisk: Level.MEDIUM,
      confidence: recent ? Level.MEDIUM : Level.HIGH,
      reasons: [
        'Volume is not attached to any instance',
        ...(recent ? [`Created ${Math.floor(ageDays ?? 0)} days ago: confirm it is not about to be used`] : []),
        'Create a snapshot before deleting: deletion is irreversible (snapshots cost less per GB)',
      ],
    };
    const label = this.label(analysis);
    return this.finish(analysis, currency, {
      monthlySavings: monthlyCost,
      targetKey: 'DELETE',
      title: `Unattached EBS volume ${label} (${this.size(analysis)})`,
      description: `${label} (${this.size(analysis)}) is not attached to any instance. Snapshot and delete it. Estimated savings: ${this.savingsText(monthlyCost, currency)}.`,
    });
  }

  private expand(analysis: EbsAnalysis, input: EbsAnalyzerInput, unitPrice: number | undefined): AnalyzerResult | null {
    const { volume, currency } = input;
    const disk = input.instanceDisk;
    if (!disk || disk.p95UsedPercent < EXPAND_TRIGGER_USED_PERCENT) return null;
    const targetSize = Math.ceil((volume.sizeGiB * disk.p95UsedPercent) / EXPAND_TARGET_USED_PERCENT);
    const increase = unitPrice === undefined ? null : round((targetSize - volume.sizeGiB) * unitPrice);
    const current = analysis.current.monthlyCost;
    const reasons = [
      `Disk usage on ${disk.instanceId}: P95 ${disk.p95UsedPercent}%, max ${disk.maxUsedPercent}% of ${volume.sizeGiB} GiB (${disk.source === 'KUBERNETES_AGENT' ? 'Cloud Cost Guardian Kubernetes agent' : 'CloudWatch Agent'})`,
      `Expanding to ${targetSize} GiB brings usage to about ${EXPAND_TARGET_USED_PERCENT}%`,
      'Online with Elastic Volumes (ModifyVolume), then grow the partition and filesystem (growpart, then resize2fs or xfs_growfs)',
      'A volume cannot be shrunk later and accepts a new modification only 6 hours after the previous one',
      ...(volume.volumeType === 'gp2' ? ['Change the type to gp3 in the same ModifyVolume call to lower the price per GB'] : []),
      ...(disk.kubernetesNode ? ['Kubernetes node: prune unused container images first (crictl rmi --prune), it may free enough space'] : []),
    ];
    analysis.finding = 'DISK_FULL';
    analysis.recommendation = {
      type: RecommendationType.EBS_EXPAND,
      source: RecommendationSource.CCG_HEURISTIC,
      action: 'EXPAND_VOLUME',
      targetVolumeType: volume.volumeType,
      targetSizeGiB: targetSize,
      performanceRisk: Level.HIGH,
      confidence: Level.HIGH,
      reasons,
    };
    const label = this.label(analysis);
    const increaseText = increase === null ? 'Cost increase unknown (price unavailable)' : `Cost increase: ${currency} ${increase}/month`;
    return this.finish(analysis, currency, {
      monthlySavings: null,
      targetKey: 'EXPAND_VOLUME',
      title: `Expand ${label} from ${volume.sizeGiB} GiB to ${targetSize} GiB`,
      description: `${label} is almost full and the instance may stop writing. ${reasons.join('. ')}. ${increaseText}.`,
      recommendedMonthlyCost: current !== null && increase !== null ? round(current + increase) : null,
      severity: Level.HIGH,
    });
  }

  private gp2ToGp3(analysis: EbsAnalysis, input: EbsAnalyzerInput, hasMetrics: boolean, unitPrice: number | undefined): AnalyzerResult | null {
    const { volume, metrics, pricePerGbMonth, currency } = input;
    if (volume.volumeType !== 'gp2') return null;
    const gp3Price = pricePerGbMonth.gp3;
    const peakIops = metrics?.peakIops ?? null;
    const peakMbps = metrics?.peakThroughputMBps ?? null;
    const exceeds =
      hasMetrics &&
      ((peakIops !== null && peakIops > GP3_BASELINE_IOPS) || (peakMbps !== null && peakMbps > GP3_BASELINE_THROUGHPUT_MBPS));
    if (exceeds) {
      analysis.metrics.notes.push(`Peak usage above gp3 baseline (${GP3_BASELINE_IOPS} IOPS / ${GP3_BASELINE_THROUGHPUT_MBPS} MB/s): gp3 would need provisioned performance`);
      return { analysis, draft: null };
    }
    const savings = unitPrice !== undefined && gp3Price !== undefined ? volume.sizeGiB * (unitPrice - gp3Price) : null;
    analysis.finding = 'GP2_TO_GP3';
    analysis.recommendation = {
      type: RecommendationType.EBS_OPTIMIZATION,
      source: RecommendationSource.CCG_HEURISTIC,
      action: 'MIGRATE_TO_GP3',
      targetVolumeType: 'gp3',
      performanceRisk: Level.LOW,
      confidence: hasMetrics ? Level.HIGH : Level.MEDIUM,
      reasons: [
        `gp3 includes ${GP3_BASELINE_IOPS} IOPS and ${GP3_BASELINE_THROUGHPUT_MBPS} MB/s at a lower price per GB`,
        hasMetrics
          ? `Observed peak: ${peakIops ?? 0} IOPS, ${peakMbps ?? 0} MB/s`
          : 'No metrics: performance compared using gp2 baseline only',
        'Migration is online (ModifyVolume), no downtime',
      ],
    };
    const label = this.label(analysis);
    const monthly = savings === null ? null : round(savings);
    return this.finish(analysis, currency, {
      monthlySavings: savings,
      targetKey: 'gp3',
      title: `Migrate ${label} from gp2 to gp3 (${volume.sizeGiB} GiB)`,
      description: `${label} can be changed from gp2 to gp3 online with the same or better baseline performance. Estimated savings: ${this.savingsText(monthly, currency)}.`,
    });
  }

  private reduceProvisioned(analysis: EbsAnalysis, input: EbsAnalyzerInput, hasMetrics: boolean): AnalyzerResult | null {
    const { volume, metrics, currency } = input;
    if (volume.volumeType !== 'gp3' || !hasMetrics || !metrics) return null;
    const currentIops = volume.iops ?? GP3_BASELINE_IOPS;
    const currentThroughput = volume.throughputMBps ?? GP3_BASELINE_THROUGHPUT_MBPS;
    const targetThroughput = Math.min(currentThroughput, this.withHeadroom(metrics.peakThroughputMBps, GP3_BASELINE_THROUGHPUT_MBPS));
    const targetIops = Math.min(
      currentIops,
      Math.max(this.withHeadroom(metrics.peakIops, GP3_BASELINE_IOPS), Math.ceil(targetThroughput / GP3_LIMITS.maxMBpsPerIops)),
    );
    if (targetIops === currentIops && targetThroughput === currentThroughput) return null;
    const target = { ...volume, iops: targetIops, throughputMBps: targetThroughput };
    const currentCost = provisionedPerformanceCost(volume, input.performancePrices);
    const targetCost = provisionedPerformanceCost(target, input.performancePrices);
    const savings = currentCost === null || targetCost === null ? null : currentCost - targetCost;
    if (savings !== null && savings <= 0) return null;

    analysis.finding = 'GP3_OVERPROVISIONED';
    analysis.recommendation = {
      type: RecommendationType.EBS_OPTIMIZATION,
      source: RecommendationSource.CCG_HEURISTIC,
      action: 'REDUCE_PROVISIONED',
      targetVolumeType: 'gp3',
      targetIops,
      targetThroughputMBps: targetThroughput,
      performanceRisk: Level.MEDIUM,
      confidence: Level.MEDIUM,
      reasons: [
        `Provisioned ${currentIops} IOPS / ${currentThroughput} MB/s, observed peak ${metrics.peakIops ?? 0} IOPS / ${metrics.peakThroughputMBps ?? 0} MB/s`,
        ...this.performanceReasons(targetIops, targetThroughput),
      ],
    };
    const label = this.label(analysis);
    const monthly = savings === null ? null : round(savings);
    return this.finish(analysis, currency, {
      monthlySavings: savings,
      targetKey: 'REDUCE_PROVISIONED',
      title: `Reduce provisioned performance of ${label} to ${targetIops} IOPS / ${targetThroughput} MB/s`,
      description: `${label} pays for gp3 IOPS/throughput it does not use. ${analysis.recommendation.reasons.join('. ')}. Estimated savings: ${this.savingsText(monthly, currency)}.`,
    });
  }

  private ioToGp3(analysis: EbsAnalysis, input: EbsAnalyzerInput, hasMetrics: boolean, currentCost: number | null): AnalyzerResult | null {
    const { volume, metrics, currency } = input;
    if (!IO_VOLUME_TYPES.includes(volume.volumeType) || !hasMetrics || !metrics) return null;
    if (metrics.peakIops === null || metrics.peakThroughputMBps === null) return null;
    if (volume.attachedInstanceIds.length > 1) {
      analysis.metrics.notes.push('Multi-Attach volume: gp3 does not support Multi-Attach');
      return null;
    }
    const targetThroughput = this.withHeadroom(metrics.peakThroughputMBps, GP3_BASELINE_THROUGHPUT_MBPS);
    const targetIops = Math.max(this.withHeadroom(metrics.peakIops, GP3_BASELINE_IOPS), Math.ceil(targetThroughput / GP3_LIMITS.maxMBpsPerIops));
    const maxIops = Math.max(GP3_BASELINE_IOPS, Math.min(GP3_LIMITS.maxIops, volume.sizeGiB * GP3_LIMITS.maxIopsPerGiB));
    if (volume.sizeGiB > GP3_LIMITS.maxSizeGiB || targetIops > maxIops || targetThroughput > GP3_LIMITS.maxThroughputMBps) {
      analysis.metrics.notes.push(`Peak usage with ${PERFORMANCE_HEADROOM}x headroom does not fit gp3 limits for ${volume.sizeGiB} GiB`);
      return null;
    }
    const targetCost = volumeMonthlyCost(
      { volumeType: 'gp3', sizeGiB: volume.sizeGiB, iops: targetIops, throughputMBps: targetThroughput },
      input.pricePerGbMonth,
      input.performancePrices,
    );
    const savings = currentCost === null || targetCost === null ? null : currentCost - targetCost;
    if (savings !== null && savings <= 0) return null;

    analysis.finding = 'IO_TO_GP3';
    analysis.recommendation = {
      type: RecommendationType.EBS_OPTIMIZATION,
      source: RecommendationSource.CCG_HEURISTIC,
      action: 'MIGRATE_TO_GP3',
      targetVolumeType: 'gp3',
      targetIops,
      targetThroughputMBps: targetThroughput,
      performanceRisk: Level.MEDIUM,
      confidence: Level.MEDIUM,
      reasons: [
        `${volume.volumeType} with ${volume.iops ?? 'unknown'} provisioned IOPS, observed peak ${metrics.peakIops} IOPS / ${metrics.peakThroughputMBps} MB/s`,
        ...this.performanceReasons(targetIops, targetThroughput),
        'gp3 latency is single-digit milliseconds while io1/io2 is sub-millisecond: check latency-sensitive databases first',
        ...(volume.volumeType === 'io2' ? ['io2 has 99.999% durability and gp3 99.8-99.9%: keep io2 where that matters'] : []),
      ],
    };
    const label = this.label(analysis);
    const monthly = savings === null ? null : round(savings);
    return this.finish(analysis, currency, {
      monthlySavings: savings,
      targetKey: 'gp3',
      title: `Migrate ${label} from ${volume.volumeType} to gp3 (${volume.sizeGiB} GiB)`,
      description: `${label} pays for provisioned IOPS it does not use. ${analysis.recommendation.reasons.join('. ')}. Estimated savings: ${this.savingsText(monthly, currency)}.`,
    });
  }

  private performanceReasons(targetIops: number, targetThroughput: number): string[] {
    return [
      `Target ${targetIops} IOPS / ${targetThroughput} MB/s keeps ${PERFORMANCE_HEADROOM}x headroom over the peak (gp3 includes ${GP3_BASELINE_IOPS} IOPS and ${GP3_BASELINE_THROUGHPUT_MBPS} MB/s)`,
      'Peaks are hourly averages: shorter bursts may be higher',
      'Online with Elastic Volumes (ModifyVolume), no downtime',
    ];
  }

  private withHeadroom(peak: number | null, floor: number): number {
    return peak === null ? Infinity : Math.max(floor, Math.ceil(peak * PERFORMANCE_HEADROOM));
  }

  private label(analysis: EbsAnalysis): string {
    return analysis.name ? `${analysis.name} (${analysis.resourceId})` : analysis.resourceId;
  }

  private size(analysis: EbsAnalysis): string {
    return `${analysis.current.sizeGiB} GiB ${analysis.current.volumeType}`;
  }

  private savingsText(monthly: number | null, currency: string): string {
    return monthly === null ? 'savings unknown (price unavailable)' : `${currency} ${round(monthly)}/month`;
  }

  private finish(analysis: EbsAnalysis, currency: string, text: DraftText): { analysis: EbsAnalysis; draft: RecommendationDraft } {
    const rec = analysis.recommendation;
    if (!rec) throw new Error('recommendation required');
    const monthly = text.monthlySavings === null ? null : round(text.monthlySavings);
    if (monthly !== null) analysis.savings = { monthly, yearly: round(monthly * 12), currency };
    const current = analysis.current.monthlyCost;
    return {
      analysis,
      draft: {
        resourceId: analysis.resourceId,
        resourceArn: analysis.resourceArn,
        service: 'ebs',
        type: rec.type,
        source: rec.source,
        title: text.title,
        description: text.description,
        severity: text.severity ?? severityFor(monthly),
        risk: rec.performanceRisk,
        confidence: rec.confidence,
        currentMonthlyCost: current,
        recommendedMonthlyCost:
          text.recommendedMonthlyCost !== undefined ? text.recommendedMonthlyCost : current !== null && monthly !== null ? round(current - monthly) : null,
        estimatedMonthlySavings: monthly,
        estimatedYearlySavings: monthly === null ? null : round(monthly * 12),
        currency,
        targetKey: text.targetKey,
        analysis,
      },
    };
  }
}
