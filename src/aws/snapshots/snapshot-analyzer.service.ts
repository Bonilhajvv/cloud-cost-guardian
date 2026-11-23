import { Injectable } from '@nestjs/common';
import { Level, RecommendationSource, RecommendationType } from '../../common/enums';
import { round } from '../../common/helpers/stats.helper';
import { severityFor } from '../ec2/helpers/risk-level.helper';
import { GIB_BYTES } from '../network/constants/network.constant';
import { DAY_MS } from '../rds/constants/rds.constant';
import { MANAGED_SNAPSHOT_TAG_KEYS, SNAPSHOT_MIN_AGE_DAYS } from './constants/snapshot.constant';
import { createdByAmi } from './helpers/normalize-snapshot.helper';
import { SnapshotAnalysis, SnapshotAnalyzerInput, SnapshotAnalyzerResult } from './interfaces/snapshot-analysis.interface';

@Injectable()
export class SnapshotAnalyzerService {
  analyze(input: SnapshotAnalyzerInput): SnapshotAnalyzerResult {
    const now = input.now ?? new Date();
    const { resource } = input;
    const createdAt = resource.kind === 'EBS_SNAPSHOT' ? resource.snapshot.startTime : resource.snapshot.createdAt;
    const ageDays = createdAt ? Math.floor((now.getTime() - Date.parse(createdAt)) / DAY_MS) : null;
    const sizeGb = resource.kind === 'EBS_SNAPSHOT' ? (resource.snapshot.fullSizeBytes === null ? resource.snapshot.volumeSizeGb : round(resource.snapshot.fullSizeBytes / GIB_BYTES)) : resource.snapshot.allocatedStorageGb;
    const maxMonthlyCost = this.maxMonthlyCost(input);
    const exclusive = resource.kind === 'EBS_SNAPSHOT' && resource.snapshot.volumeId !== null && input.otherSnapshotsOfSource === 0;
    const monthlyCost = exclusive ? maxMonthlyCost : null;
    const analysis: SnapshotAnalysis = {
      kind: 'SNAPSHOT',
      resourceId: input.resourceId,
      resourceArn: input.resourceArn,
      name: resource.kind === 'EBS_SNAPSHOT' ? resource.snapshot.name : resource.snapshot.snapshotId,
      region: resource.snapshot.region,
      finding: 'OLD',
      ageDays,
      current: { resource: resource.kind, sizeGb, monthlyCost, maxMonthlyCost },
      recommendation: null,
      savings: null,
      analyzedAt: now.toISOString(),
    };

    if (resource.kind === 'EBS_SNAPSHOT' && resource.snapshot.amiId) analysis.finding = 'IN_USE';
    else if (MANAGED_SNAPSHOT_TAG_KEYS.some((k) => k in resource.snapshot.tags)) analysis.finding = 'MANAGED';
    else if (ageDays === null || ageDays < SNAPSHOT_MIN_AGE_DAYS) analysis.finding = 'RECENT';
    if (analysis.finding !== 'OLD') return { analysis, draft: null };

    const type = resource.kind === 'EBS_SNAPSHOT' ? RecommendationType.EBS_SNAPSHOT_OLD : RecommendationType.RDS_SNAPSHOT_OLD;
    const confidence = input.sourceExists ? Level.MEDIUM : Level.HIGH;
    const reasons = [...this.reasons(input, ageDays as number, sizeGb, maxMonthlyCost, exclusive), 'Deleting a snapshot cannot be undone: confirm no retention or compliance policy requires it'];
    if (resource.kind === 'EBS_SNAPSHOT' && resource.snapshot.storageTier === 'standard') reasons.push('If it must be kept, move it to the archive tier (75% cheaper, 90-day minimum, paid restore)');
    analysis.recommendation = { type, source: RecommendationSource.CCG_HEURISTIC, performanceRisk: Level.MEDIUM, confidence, reasons };
    if (monthlyCost !== null) analysis.savings = { monthly: monthlyCost, yearly: round(monthlyCost * 12), currency: input.currency };
    const label = resource.kind === 'EBS_SNAPSHOT' ? `EBS snapshot ${input.resourceId}${resource.snapshot.name ? ` (${resource.snapshot.name})` : ''}` : `RDS snapshot ${input.resourceId}`;
    const savingsText = monthlyCost === null ? 'savings unknown' : `${input.currency} ${monthlyCost}/month`;
    return {
      analysis,
      draft: {
        resourceId: input.resourceId,
        resourceArn: input.resourceArn,
        service: resource.kind === 'EBS_SNAPSHOT' ? 'ec2' : 'rds',
        type,
        source: RecommendationSource.CCG_HEURISTIC,
        title: `Delete old ${label}`,
        description: `${reasons.join('. ')}. Estimated savings: ${savingsText}.`,
        severity: severityFor(monthlyCost),
        risk: Level.MEDIUM,
        confidence,
        currentMonthlyCost: monthlyCost,
        recommendedMonthlyCost: monthlyCost === null ? null : 0,
        estimatedMonthlySavings: monthlyCost,
        estimatedYearlySavings: monthlyCost === null ? null : round(monthlyCost * 12),
        currency: input.currency,
        targetKey: 'DELETE',
        analysis,
      },
    };
  }

  private maxMonthlyCost(input: SnapshotAnalyzerInput): number | null {
    const { resource, pricePerGbMonth } = input;
    if (resource.kind !== 'EBS_SNAPSHOT' || pricePerGbMonth === null) return null;
    if (resource.snapshot.storageTier !== 'standard' || resource.snapshot.fullSizeBytes === null) return null;
    return round((resource.snapshot.fullSizeBytes / GIB_BYTES) * pricePerGbMonth);
  }

  private reasons(input: SnapshotAnalyzerInput, ageDays: number, sizeGb: number, maxMonthlyCost: number | null, exclusive: boolean): string[] {
    const { resource, currency } = input;
    if (resource.kind === 'RDS_SNAPSHOT') {
      const source = resource.snapshot.dbInstanceId;
      return [
        `Manual snapshot is ${ageDays} days old (${sizeGb} GB allocated${resource.snapshot.engine ? `, ${resource.snapshot.engine}` : ''})`,
        ...(source && !input.sourceExists ? [`Database ${source} no longer exists`] : []),
        'RDS bills manual snapshots as backup storage beyond a free allowance equal to the provisioned storage in the region, so the saving depends on the other backups',
      ];
    }
    const s = resource.snapshot;
    const ami = createdByAmi(s);
    return [
      `Snapshot is ${ageDays} days old (${sizeGb} GB of data)`,
      ...(s.volumeId && !input.sourceExists ? [`Source volume ${s.volumeId} no longer exists`] : []),
      ...(ami ? [`AMI ${ami} that created it was deregistered`] : []),
      ...(!exclusive && maxMonthlyCost !== null
        ? [`Snapshots are incremental: deleting it frees only the blocks no other snapshot shares, at most ${currency} ${maxMonthlyCost}/month`]
        : []),
    ];
  }
}
