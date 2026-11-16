import { Injectable } from '@nestjs/common';
import { Level, RecommendationSource, RecommendationType } from '../../common/enums';
import { round } from '../../common/helpers/stats.helper';
import { RecommendationDraft } from '../core/interfaces/recommendation-draft.interface';
import { severityFor } from '../ec2/helpers/risk-level.helper';
import { HOURS_PER_MONTH } from '../pricing/constants/pricing.constant';
import { HIGH_COMMITMENT_UTILIZATION, MIN_COMMITMENT_MONTHLY_SAVINGS } from './constants/commitment.constant';
import { CommitmentAnalysis, CommitmentAnalyzerInput, CommitmentAnalyzerResult } from './interfaces/commitment-analysis.interface';

@Injectable()
export class CommitmentAnalyzerService {
  analyze(input: CommitmentAnalyzerInput): CommitmentAnalyzerResult {
    const now = (input.now ?? new Date()).toISOString();
    const savingsPlan = this.savingsPlan(input, now);
    const reservations = this.rdsReservations(input, now);
    return {
      analyses: [savingsPlan.analysis, reservations.analysis],
      drafts: [savingsPlan.draft, reservations.draft].filter((d): d is RecommendationDraft => d !== null),
    };
  }

  private savingsPlan(input: CommitmentAnalyzerInput, analyzedAt: string): { analysis: CommitmentAnalysis; draft: RecommendationDraft | null } {
    const { snapshot, currency, awsAccountId } = input;
    const rec = snapshot.savingsPlans.oneYear;
    const coverage = snapshot.savingsPlansCoverage?.coveragePercentage ?? null;
    const analysis = this.base(awsAccountId, 'compute-savings-plan', 'Compute Savings Plan', rec?.currentOnDemandMonthly ?? null, coverage, analyzedAt);
    if (!rec || rec.monthlySavings < MIN_COMMITMENT_MONTHLY_SAVINGS) return { analysis, draft: null };

    const monthlyCommitment = round(rec.hourlyCommitment * HOURS_PER_MONTH);
    const longer = snapshot.savingsPlans.threeYears;
    const utilization = rec.estimatedUtilization;
    const reasons = [
      `On-demand compute spend of the last 30 days: ${currency} ${rec.currentOnDemandMonthly ?? 'unknown'} (EC2, Fargate and Lambda)${coverage === null ? '' : `, ${coverage}% already covered by Savings Plans`}`,
      `Commit ${currency} ${rec.hourlyCommitment}/hour (${currency} ${monthlyCommitment}/month) for 1 year, no upfront: estimated savings ${currency} ${rec.monthlySavings}/month${rec.savingsPercentage === null ? '' : ` (${rec.savingsPercentage}%)`}`,
      ...(utilization === null ? [] : [`Expected use of the commitment: ${utilization}%`]),
      ...(longer && longer.monthlySavings > rec.monthlySavings
        ? [`3-year alternative: ${currency} ${longer.hourlyCommitment}/hour saves ${currency} ${longer.monthlySavings}/month, with a longer lock-in`]
        : []),
      'Applies to any EC2 instance family, size, region and OS, plus Fargate and Lambda',
      'Apply open rightsizing and idle recommendations first: they lower usage and the commitment you need',
      'The commitment is billed every hour for the whole term, even if usage drops',
    ];
    const confidence = utilization !== null && utilization >= HIGH_COMMITMENT_UTILIZATION ? Level.HIGH : Level.MEDIUM;
    analysis.finding = 'PURCHASE';
    analysis.recommendation = {
      type: RecommendationType.SAVINGS_PLAN_PURCHASE,
      source: RecommendationSource.COST_EXPLORER,
      term: rec.term,
      hourlyCommitment: rec.hourlyCommitment,
      performanceRisk: Level.MEDIUM,
      confidence,
      reasons,
    };
    analysis.savings = { monthly: rec.monthlySavings, yearly: round(rec.monthlySavings * 12), currency };
    return {
      analysis,
      draft: this.draft(analysis, {
        title: `Buy a Compute Savings Plan: ${currency} ${rec.hourlyCommitment}/hour for 1 year, no upfront`,
        description: `${reasons.join('. ')}.`,
        current: rec.currentOnDemandMonthly,
        savings: rec.monthlySavings,
        confidence,
        targetKey: 'COMPUTE_SP_1Y_NO_UPFRONT',
        currency,
      }),
    };
  }

  private rdsReservations(input: CommitmentAnalyzerInput, analyzedAt: string): { analysis: CommitmentAnalysis; draft: RecommendationDraft | null } {
    const { snapshot, currency, awsAccountId } = input;
    const rec = snapshot.rdsReservations;
    const onDemand = rec ? round(rec.items.reduce((s, i) => s + (i.onDemandMonthly ?? 0), 0)) : null;
    const analysis = this.base(awsAccountId, 'rds-reserved-instances', 'RDS Reserved Instances', onDemand, null, analyzedAt);
    if (!rec || rec.monthlySavings < MIN_COMMITMENT_MONTHLY_SAVINGS) return { analysis, draft: null };

    const utilizations = rec.items.map((i) => i.utilization).filter((u): u is number => u !== null);
    const lowest = utilizations.length ? Math.min(...utilizations) : null;
    const reasons = [
      ...rec.items.map(
        (i) =>
          `${i.count} x ${i.instanceType} ${i.engine ?? ''} ${i.deploymentOption ?? ''}${i.region ? ` in ${i.region}` : ''}: saves ${currency} ${i.monthlySavings}/month${i.utilization === null ? '' : `, expected use ${i.utilization}%`}`.replace(/\s+/g, ' '),
      ),
      ...(rec.items.some((i) => i.sizeFlexible)
        ? ['Size flexible: larger classes of the same family count as several units of the recommended class (for example, one medium counts as 4 micro units)']
        : []),
      `1 year, no upfront${rec.savingsPercentage === null ? '' : `: about ${rec.savingsPercentage}% cheaper than on-demand`}`,
      'Apply RDS rightsizing and idle recommendations first: a reservation is billed even if the database is resized, stopped or deleted',
    ];
    const confidence = lowest !== null && lowest >= HIGH_COMMITMENT_UTILIZATION ? Level.HIGH : Level.MEDIUM;
    analysis.finding = 'PURCHASE';
    analysis.recommendation = {
      type: RecommendationType.RESERVED_INSTANCE_PURCHASE,
      source: RecommendationSource.COST_EXPLORER,
      term: rec.term,
      hourlyCommitment: null,
      performanceRisk: Level.MEDIUM,
      confidence,
      reasons,
    };
    analysis.savings = { monthly: rec.monthlySavings, yearly: round(rec.monthlySavings * 12), currency };
    const first = rec.items[0];
    return {
      analysis,
      draft: this.draft(analysis, {
        title:
          rec.items.length === 1
            ? `Buy RDS Reserved Instances: ${first.count} x ${first.instanceType} for 1 year, no upfront`
            : `Buy RDS Reserved Instances for ${rec.items.length} instance types, 1 year, no upfront`,
        description: `${reasons.join('. ')}. Estimated savings: ${currency} ${rec.monthlySavings}/month.`,
        current: onDemand,
        savings: rec.monthlySavings,
        confidence,
        targetKey: 'RDS_RI_1Y_NO_UPFRONT',
        currency,
      }),
    };
  }

  private base(awsAccountId: string, suffix: string, name: string, monthlyCost: number | null, coverage: number | null, analyzedAt: string): CommitmentAnalysis {
    return {
      kind: 'COMMITMENT',
      resourceId: `${awsAccountId}/${suffix}`,
      resourceArn: `arn:aws:iam::${awsAccountId}:root`,
      name,
      region: 'global',
      finding: 'NO_RECOMMENDATION',
      current: { monthlyCost, coveragePercentage: coverage },
      recommendation: null,
      savings: null,
      analyzedAt,
    };
  }

  private draft(
    analysis: CommitmentAnalysis,
    o: { title: string; description: string; current: number | null; savings: number; confidence: Level; targetKey: string; currency: string },
  ): RecommendationDraft {
    const monthly = round(o.savings);
    return {
      resourceId: analysis.resourceId,
      resourceArn: analysis.resourceArn,
      service: analysis.recommendation?.type === RecommendationType.SAVINGS_PLAN_PURCHASE ? 'savingsplans' : 'rds',
      type: analysis.recommendation?.type as RecommendationType,
      source: RecommendationSource.COST_EXPLORER,
      title: o.title,
      description: o.description,
      severity: severityFor(monthly),
      risk: Level.MEDIUM,
      confidence: o.confidence,
      currentMonthlyCost: o.current,
      recommendedMonthlyCost: o.current === null ? null : round(o.current - monthly),
      estimatedMonthlySavings: monthly,
      estimatedYearlySavings: round(monthly * 12),
      currency: o.currency,
      targetKey: o.targetKey,
      analysis,
    };
  }
}

