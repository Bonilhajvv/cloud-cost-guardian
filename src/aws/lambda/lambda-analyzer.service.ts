import { Injectable } from '@nestjs/common';
import { Level, RecommendationSource, RecommendationType } from '../../common/enums';
import { round } from '../../common/helpers/stats.helper';
import { DAYS_PER_MONTH } from '../../cost-reports/constants/cost-sync.constant';
import { buildServiceAnalysis } from '../core/helpers/service-analysis.helper';
import { ServiceAnalysisResult, ServiceOpportunity } from '../core/interfaces/service-analysis.interface';
import { LAMBDA_ARM64_MIN_SAVINGS, LAMBDA_ARM64_RUNTIMES, LAMBDA_PROVISIONED_HEADROOM, LAMBDA_PROVISIONED_MAX_UTILIZATION, LAMBDA_PROVISIONED_MIN_DATAPOINTS, SECONDS_PER_MONTH } from './constants/lambda.constant';
import { LambdaAnalyzerInput } from './interfaces/lambda.interface';

@Injectable()
export class LambdaAnalyzerService {
  analyze(input: LambdaAnalyzerInput): ServiceAnalysisResult {
    const { fn, usage, prices, currency } = input;
    const gbSeconds = this.monthlyGbSeconds(input);
    const durationPrice = prices.durationGbSecond[fn.architecture];
    const durationCost = gbSeconds === null || durationPrice === null ? null : gbSeconds * durationPrice;
    const provisionedCost = this.provisionedCost(input);
    const monthlyCost = durationCost === null || provisionedCost === null ? null : round(durationCost + provisionedCost);
    const base = {
      kind: 'LAMBDA' as const,
      resourceId: fn.arn,
      resourceArn: fn.arn,
      name: fn.functionName,
      region: fn.region,
      finding: usage.invocations === 0 ? 'NOT_INVOKED' : 'OPTIMIZED',
      current: {
        monthlyCost,
        details: {
          runtime: fn.runtime,
          architecture: fn.architecture,
          memoryMb: fn.memoryMb,
          packageType: fn.packageType,
          invocations: usage.invocations,
          provisionedConcurrency: input.provisioned.reduce((s, p) => s + p.allocated, 0),
        },
      },
      notes: [
        monthlyCost === null ? 'Duration cost unavailable (no metrics or price)' : 'Monthly cost estimated from duration and provisioned concurrency at on-demand prices: requests, free tier and Savings Plans are not included',
      ],
    };
    const opportunities = [this.memory(input), this.arm64(input, gbSeconds), ...this.provisioned(input)].filter((o): o is ServiceOpportunity => o !== null);
    return buildServiceAnalysis(base, 'lambda', opportunities, currency, input.now ?? new Date());
  }

  private memory(input: LambdaAnalyzerInput): ServiceOpportunity | null {
    const { fn, optimizer } = input;
    if (!optimizer || optimizer.currentMemoryMb !== fn.memoryMb) return null;
    const option = [...optimizer.options].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).find((o) => o.memoryMb !== fn.memoryMb && (o.estimatedMonthlySavings ?? 0) > 0);
    if (!option) return null;
    const smaller = option.memoryMb < fn.memoryMb;
    return {
      type: RecommendationType.LAMBDA_RIGHTSIZING,
      targetKey: String(option.memoryMb),
      title: `Change memory of Lambda ${fn.functionName}: ${fn.memoryMb} MB to ${option.memoryMb} MB`,
      reasons: [
        `AWS Compute Optimizer finding: ${optimizer.finding}${optimizer.reasonCodes.length ? ` (${optimizer.reasonCodes.join(', ')})` : ''}`,
        smaller ? 'Lambda CPU is proportional to memory: compare duration before and after with an alias' : 'More memory also gives more CPU and shortens the duration',
      ],
      monthlySavings: option.estimatedMonthlySavings,
      risk: smaller ? Level.MEDIUM : Level.LOW,
      confidence: Level.HIGH,
      source: RecommendationSource.COMPUTE_OPTIMIZER,
    };
  }

  private arm64(input: LambdaAnalyzerInput, gbSeconds: number | null): ServiceOpportunity | null {
    const { fn, prices } = input;
    if (fn.architecture !== 'x86_64' || fn.packageType !== 'Zip' || !fn.runtime || !LAMBDA_ARM64_RUNTIMES.test(fn.runtime)) return null;
    const { x86_64, arm64 } = prices.durationGbSecond;
    if (gbSeconds === null || x86_64 === null || arm64 === null) return null;
    const savings = gbSeconds * (x86_64 - arm64);
    if (savings < LAMBDA_ARM64_MIN_SAVINGS) return null;
    return {
      type: RecommendationType.LAMBDA_ARM64,
      targetKey: 'arm64',
      title: `Move Lambda ${fn.functionName} to arm64`,
      reasons: [
        `${fn.runtime} runs on Graviton and each GB-second costs ${Math.round((1 - arm64 / x86_64) * 100)}% less`,
        'Native dependencies, layers and extensions must exist for arm64: rebuild and test before the change',
        'The savings assume the same duration and do not subtract Savings Plans',
      ],
      monthlySavings: savings,
      risk: Level.MEDIUM,
      confidence: Level.MEDIUM,
    };
  }

  private provisioned(input: LambdaAnalyzerInput): ServiceOpportunity[] {
    const { fn, prices } = input;
    const price = prices.provisionedGbSecond[fn.architecture];
    return input.provisioned.flatMap((p) => {
      if (p.peakUtilization === null || p.datapoints < LAMBDA_PROVISIONED_MIN_DATAPOINTS || p.peakUtilization >= LAMBDA_PROVISIONED_MAX_UTILIZATION) return [];
      const target = Math.ceil(p.allocated * p.peakUtilization * LAMBDA_PROVISIONED_HEADROOM);
      if (target >= p.allocated) return [];
      const savings = price === null ? null : (p.allocated - target) * (fn.memoryMb / 1024) * price * SECONDS_PER_MONTH;
      return [
        {
          type: RecommendationType.LAMBDA_PROVISIONED_CONCURRENCY,
          targetKey: `${p.qualifier}:${target}`,
          title: `Reduce provisioned concurrency of Lambda ${fn.functionName}:${p.qualifier} from ${p.allocated} to ${target}`,
          reasons: [
            `Peak use of the provisioned concurrency in ${input.usage.periodDays} days was ${round(p.peakUtilization * 100)}%`,
            'Below the provisioned level, requests above it still run but may have cold starts',
            'If Application Auto Scaling manages it, change the scaling limits instead',
          ],
          monthlySavings: savings,
          risk: Level.LOW,
          confidence: Level.HIGH,
          resourceId: `${fn.arn}:${p.qualifier}`,
          resourceArn: `${fn.arn}:${p.qualifier}`,
        },
      ];
    });
  }

  private monthlyGbSeconds(input: LambdaAnalyzerInput): number | null {
    const { usage, fn } = input;
    if (usage.durationMs === null) return usage.invocations === 0 ? 0 : null;
    return (usage.durationMs / 1000 / usage.periodDays) * DAYS_PER_MONTH * (fn.memoryMb / 1024);
  }

  private provisionedCost(input: LambdaAnalyzerInput): number | null {
    const allocated = input.provisioned.reduce((s, p) => s + p.allocated, 0);
    if (allocated === 0) return 0;
    const price = input.prices.provisionedGbSecond[input.fn.architecture];
    return price === null ? null : allocated * (input.fn.memoryMb / 1024) * price * SECONDS_PER_MONTH;
  }
}
