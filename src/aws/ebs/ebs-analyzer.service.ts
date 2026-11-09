import { Injectable } from '@nestjs/common';
import { Level, RecommendationSource, RecommendationType } from '../../common/enums';
import { round } from '../../common/helpers/stats.helper';
import { RecommendationDraft } from '../core/interfaces/recommendation-draft.interface';
import { severityFor } from '../ec2/helpers/risk-level.helper';
import {
  DAY_MS,
  GP3_BASELINE_IOPS,
  GP3_BASELINE_THROUGHPUT_MBPS,
  MIN_EBS_DATAPOINTS,
  RECENT_VOLUME_DAYS,
} from './constants/ebs.constant';
import { EbsAnalysis, EbsAnalyzerInput } from './interfaces/ebs-analysis.interface';

@Injectable()
export class EbsAnalyzerService {
  analyze(input: EbsAnalyzerInput): { analysis: EbsAnalysis; draft: RecommendationDraft | null } {
    const { volume, metrics, pricePerGbMonth, currency } = input;
    const now = input.now ?? new Date();
    const unitPrice = pricePerGbMonth[volume.volumeType];
    const monthlyCost = unitPrice === undefined ? null : round(volume.sizeGiB * unitPrice);
    const hasMetrics = (metrics?.datapoints ?? 0) >= MIN_EBS_DATAPOINTS;
    const notes: string[] = [];
    if (monthlyCost === null) notes.push('Storage price unavailable');
    if (!hasMetrics && volume.state === 'in-use') notes.push('Not enough EBS metrics to evaluate performance');
    if (volume.iops && ['io1', 'io2'].includes(volume.volumeType)) notes.push('Provisioned IOPS cost not included in monthly cost');

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
        monthlyCost,
        attachedTo: volume.attachedInstanceIds,
      },
      metrics: {
        avgIops: metrics?.avgIops ?? null,
        peakIops: metrics?.peakIops ?? null,
        peakThroughputMBps: metrics?.peakThroughputMBps ?? null,
        burstBalanceMin: metrics?.burstBalanceMin ?? null,
        notes,
      },
      recommendation: null,
      savings: null,
      analyzedAt: now.toISOString(),
    };

    if (volume.state === 'available') {
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
      return this.finish(analysis, monthlyCost, currency, 'DELETE');
    }

    if (volume.volumeType === 'gp2' && volume.state === 'in-use' && input.attachedToStoppedInstance) {
      notes.push('Attached instance is stopped: see the stopped instance recommendation');
      return { analysis, draft: null };
    }

    if (volume.volumeType === 'gp2' && volume.state === 'in-use') {
      const gp3Price = pricePerGbMonth.gp3;
      const peakIops = metrics?.peakIops ?? null;
      const peakMbps = metrics?.peakThroughputMBps ?? null;
      const exceeds =
        hasMetrics &&
        ((peakIops !== null && peakIops > GP3_BASELINE_IOPS) || (peakMbps !== null && peakMbps > GP3_BASELINE_THROUGHPUT_MBPS));
      if (exceeds) {
        notes.push(`Peak usage above gp3 baseline (${GP3_BASELINE_IOPS} IOPS / ${GP3_BASELINE_THROUGHPUT_MBPS} MB/s): gp3 would need provisioned performance`);
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
      return this.finish(analysis, savings, currency, 'gp3');
    }

    return { analysis, draft: null };
  }

  private finish(
    analysis: EbsAnalysis,
    monthlySavings: number | null,
    currency: string,
    targetKey: string,
  ): { analysis: EbsAnalysis; draft: RecommendationDraft } {
    const rec = analysis.recommendation;
    if (!rec) throw new Error('recommendation required');
    const monthly = monthlySavings === null ? null : round(monthlySavings);
    if (monthly !== null) analysis.savings = { monthly, yearly: round(monthly * 12), currency };
    const label = analysis.name ? `${analysis.name} (${analysis.resourceId})` : analysis.resourceId;
    const size = `${analysis.current.sizeGiB} GiB ${analysis.current.volumeType}`;
    const savingsText = monthly === null ? 'savings unknown (price unavailable)' : `${currency} ${monthly}/month`;
    const unused = rec.type === RecommendationType.EBS_UNUSED;
    return {
      analysis,
      draft: {
        resourceId: analysis.resourceId,
        resourceArn: analysis.resourceArn,
        service: 'ebs',
        type: rec.type,
        source: rec.source,
        title: unused ? `Unattached EBS volume ${label} (${size})` : `Migrate ${label} from gp2 to gp3 (${analysis.current.sizeGiB} GiB)`,
        description: unused
          ? `${label} (${size}) is not attached to any instance. Snapshot and delete it. Estimated savings: ${savingsText}.`
          : `${label} can be changed from gp2 to gp3 online with the same or better baseline performance. Estimated savings: ${savingsText}.`,
        severity: severityFor(monthly),
        risk: rec.performanceRisk,
        confidence: rec.confidence,
        currentMonthlyCost: analysis.current.monthlyCost,
        recommendedMonthlyCost:
          analysis.current.monthlyCost !== null && monthly !== null ? round(analysis.current.monthlyCost - monthly) : null,
        estimatedMonthlySavings: monthly,
        estimatedYearlySavings: monthly === null ? null : round(monthly * 12),
        currency,
        targetKey,
        analysis,
      },
    };
  }
}
