import { RecommendationType } from '../../common/enums';
import { LambdaAnalyzerInput } from './interfaces/lambda.interface';
import { LambdaAnalyzerService } from './lambda-analyzer.service';

const ARN = 'arn:aws:lambda:us-east-1:111122223333:function:api';
const input = (fn: object = {}, over: Partial<LambdaAnalyzerInput> = {}): LambdaAnalyzerInput => ({
  fn: { functionName: 'api', arn: ARN, region: 'us-east-1', runtime: 'nodejs22.x', packageType: 'Zip', architecture: 'x86_64', memoryMb: 1024, ...fn },
  usage: { periodDays: 14, invocations: 1_000_000, durationMs: 1_400_000_000 },
  provisioned: [],
  prices: { durationGbSecond: { x86_64: 0.0000166667, arm64: 0.0000133334 }, provisionedGbSecond: { x86_64: 0.0000041667, arm64: 0.0000033334 } },
  currency: 'USD',
  ...over,
});

describe('LambdaAnalyzerService', () => {
  const analyzer = new LambdaAnalyzerService();

  it('prices the duration and recommends arm64', () => {
    const { analysis, drafts } = analyzer.analyze(input());
    expect(analysis.current.monthlyCost).toBe(50.67);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ type: RecommendationType.LAMBDA_ARM64, resourceId: ARN, estimatedMonthlySavings: 10.13 });
  });

  it('does not recommend arm64 for containers, custom runtimes or arm functions', () => {
    for (const fn of [{ packageType: 'Image' }, { runtime: 'provided.al2023' }, { architecture: 'arm64' }]) expect(analyzer.analyze(input(fn)).drafts).toEqual([]);
  });

  it('uses Compute Optimizer for memory, ignoring recommendations for another size', () => {
    const optimizer = { functionArn: ARN, functionName: 'api', currentMemoryMb: 1024, finding: 'NotOptimized', reasonCodes: ['MemoryOverprovisioned'], options: [{ memoryMb: 512, rank: 1, estimatedMonthlySavings: 20 }] };
    expect(analyzer.analyze(input({ architecture: 'arm64' }, { optimizer })).drafts[0]).toMatchObject({ type: RecommendationType.LAMBDA_RIGHTSIZING, targetKey: '512', estimatedMonthlySavings: 20 });
    expect(analyzer.analyze(input({ architecture: 'arm64', memoryMb: 2048 }, { optimizer })).drafts).toEqual([]);
  });

  it('reduces underused provisioned concurrency with headroom', () => {
    const provisioned = [{ qualifier: 'live', allocated: 10, peakUtilization: 0.2, datapoints: 14 }];
    const { drafts } = analyzer.analyze(input({ architecture: 'arm64' }, { provisioned }));
    expect(drafts[0]).toMatchObject({ type: RecommendationType.LAMBDA_PROVISIONED_CONCURRENCY, targetKey: 'live:3', resourceId: `${ARN}:live`, estimatedMonthlySavings: 61.32 });
    expect(analyzer.analyze(input({ architecture: 'arm64' }, { provisioned: [{ ...provisioned[0], peakUtilization: 0.8 }] })).drafts).toEqual([]);
    expect(analyzer.analyze(input({ architecture: 'arm64' }, { provisioned: [{ ...provisioned[0], peakUtilization: null, datapoints: 0 }] })).drafts).toEqual([]);
  });
});
