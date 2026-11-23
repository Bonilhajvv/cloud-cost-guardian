import { LambdaFunctionRecommendation } from '@aws-sdk/client-compute-optimizer';
import { LambdaOptimizerRecommendation } from '../interfaces/lambda-optimizer.interface';

export function normalizeLambdaRecommendation(r: LambdaFunctionRecommendation): LambdaOptimizerRecommendation | null {
  const functionName = r.functionArn?.split(':')[6];
  if (!r.functionArn || !functionName || !r.currentMemorySize) return null;
  return {
    functionArn: r.functionArn,
    functionName,
    currentMemoryMb: r.currentMemorySize,
    finding: r.finding ?? 'Unavailable',
    reasonCodes: r.findingReasonCodes ?? [],
    options: (r.memorySizeRecommendationOptions ?? []).flatMap((o) =>
      o.memorySize ? [{ memoryMb: o.memorySize, rank: o.rank ?? null, estimatedMonthlySavings: o.savingsOpportunity?.estimatedMonthlySavings?.value ?? null }] : [],
    ),
  };
}
