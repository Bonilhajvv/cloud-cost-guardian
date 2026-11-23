import { RecommendationSource } from '../../../common/enums';
import { round } from '../../../common/helpers/stats.helper';
import { severityFor } from '../../ec2/helpers/risk-level.helper';
import { ServiceAnalysis, ServiceAnalysisBase, ServiceAnalysisResult, ServiceOpportunity } from '../interfaces/service-analysis.interface';

export function buildServiceAnalysis(base: ServiceAnalysisBase, service: string, opportunities: readonly ServiceOpportunity[], currency: string, now: Date): ServiceAnalysisResult {
  const total = opportunities.reduce((sum, o) => sum + (o.monthlySavings ?? 0), 0);
  const [main] = opportunities;
  const analysis: ServiceAnalysis = {
    ...base,
    finding: main?.type ?? base.finding ?? 'OPTIMIZED',
    recommendation: main
      ? { type: main.type, source: main.source ?? RecommendationSource.CCG_HEURISTIC, performanceRisk: main.risk, confidence: main.confidence, reasons: main.reasons }
      : null,
    opportunities: opportunities.map((o) => o.type),
    savings: total > 0 ? { monthly: round(total), yearly: round(total * 12), currency } : null,
    analyzedAt: now.toISOString(),
  };
  const drafts = opportunities.map((o) => {
    const monthly = o.monthlySavings === null ? null : round(o.monthlySavings);
    const current = o.currentMonthlyCost === undefined ? base.current.monthlyCost : o.currentMonthlyCost;
    return {
      resourceId: o.resourceId ?? base.resourceId,
      resourceArn: o.resourceId ? (o.resourceArn ?? null) : base.resourceArn,
      service,
      type: o.type,
      source: o.source ?? RecommendationSource.CCG_HEURISTIC,
      title: o.title,
      description: `${o.reasons.join('. ')}. Estimated savings: ${monthly === null ? 'unknown' : `${currency} ${monthly}/month`}.`,
      severity: severityFor(monthly),
      risk: o.risk,
      confidence: o.confidence,
      currentMonthlyCost: current === null ? null : round(current),
      recommendedMonthlyCost: current !== null && monthly !== null ? round(Math.max(0, current - monthly)) : null,
      estimatedMonthlySavings: monthly,
      estimatedYearlySavings: monthly === null ? null : round(monthly * 12),
      currency,
      targetKey: o.targetKey,
      analysis,
    };
  });
  return { analysis, drafts };
}
