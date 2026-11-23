import { Injectable, Logger } from '@nestjs/common';
import { forEachRegion } from '../aws/core/helpers/region-runner.helper';
import { LambdaAnalyzerService } from '../aws/lambda/lambda-analyzer.service';
import { LambdaService } from '../aws/lambda/lambda.service';
import { LambdaFunction } from '../aws/lambda/interfaces/lambda.interface';
import { CloudWatchService } from '../aws/metrics/cloudwatch.service';
import { DAY } from '../aws/metrics/constants/cloudwatch.constant';
import { MetricQuerySpec } from '../aws/metrics/interfaces/ebs-metrics.interface';
import { ComputeOptimizerService } from '../aws/optimizer/compute-optimizer.service';
import { PricingService } from '../aws/pricing/pricing.service';
import { AwsAccount } from '../aws-accounts/entities/aws-account.entity';
import { LAMBDA_RECOMMENDATION_TYPES } from '../recommendations/constants/recommendation.constant';
import { LAMBDA_FUNCTION_RESOURCE_TYPE } from '../resource-inventory/constants/resource-types.constant';
import { ResourceInventoryService } from '../resource-inventory/resource-inventory.service';
import { DEFAULT_CURRENCY, METRICS_PERIOD_DAYS } from './constants/scan.constant';
import { groupByRegion } from './helpers/group-by-region.helper';
import { OptimizerSyncDetails, ServiceAnalysisDetails, ServiceScanDetails } from './interfaces/scan-report.interface';
import { ServiceAnalysisRunner } from './service-analysis-runner.service';

@Injectable()
export class LambdaScanService {
  private readonly logger = new Logger(LambdaScanService.name);

  constructor(
    private readonly inventory: ResourceInventoryService,
    private readonly lambda: LambdaService,
    private readonly cloudWatch: CloudWatchService,
    private readonly pricing: PricingService,
    private readonly optimizer: ComputeOptimizerService,
    private readonly analyzer: LambdaAnalyzerService,
    private readonly runner: ServiceAnalysisRunner,
  ) {}

  async scan(account: AwsAccount, regions: readonly string[], seenAt: Date): Promise<ServiceScanDetails> {
    const unavailable = new Set<string>();
    const run = await forEachRegion([...regions], async (region) => {
      const functions = await this.runner.readable(account, 'ListFunctions', unavailable, () => this.lambda.listFunctions(account, region));
      if (functions === null) {
        await this.inventory.keepSeen(account.id, LAMBDA_FUNCTION_RESOURCE_TYPE, seenAt, [region]);
        return 0;
      }
      await this.enrichRegion(account, region, functions, seenAt, unavailable);
      return functions.length;
    });
    return { resources: run.results.reduce((s, r) => s + r.value, 0), unavailable: [...unavailable], failures: run.failures };
  }

  async syncOptimizer(account: AwsAccount): Promise<Omit<OptimizerSyncDetails, 'rds' | 'lambda'>> {
    const resources = (await this.inventory.findByType(account.id, LAMBDA_FUNCTION_RESOURCE_TYPE)).filter((r) => r.metadata.lambdaFunction);
    const byRegion = groupByRegion(resources, (r) => r.region);
    const regions: Record<string, string> = {};
    let total = 0;
    const run = await forEachRegion([...byRegion.keys()], async (region) => {
      const result = await this.optimizer.getLambdaRecommendations(account, region);
      regions[region] = result.availability;
      const byName = new Map(result.recommendations.map((r) => [r.functionName, r]));
      for (const resource of byRegion.get(region) ?? []) {
        const data = resource.metadata.lambdaFunction;
        if (!data) continue;
        await this.inventory.patchMetadata(account.id, LAMBDA_FUNCTION_RESOURCE_TYPE, resource.resourceId, {
          lambdaFunction: { ...data, optimizer: byName.get(data.fn.functionName) ?? null },
        });
      }
      total += result.recommendations.length;
    });
    return { regions, recommendations: total, failures: run.failures };
  }

  analyze(account: AwsAccount): Promise<ServiceAnalysisDetails> {
    return this.runner.analyze(
      account,
      LAMBDA_FUNCTION_RESOURCE_TYPE,
      LAMBDA_RECOMMENDATION_TYPES,
      (r) => (r.metadata.lambdaFunction ? this.analyzer.analyze({ ...r.metadata.lambdaFunction, currency: DEFAULT_CURRENCY }) : null),
      (r) => r.metadata.lambdaFunction?.provisioned.map((p) => `${r.metadata.lambdaFunction?.fn.arn}:${p.qualifier}`) ?? [],
    );
  }

  private async enrichRegion(account: AwsAccount, region: string, functions: LambdaFunction[], seenAt: Date, unavailable: Set<string>): Promise<void> {
    if (functions.length === 0) return;
    const provisioned =
      (await this.runner.readable(account, 'ListProvisionedConcurrencyConfigs', unavailable, () => this.lambda.provisionedConcurrency(account, region, functions.map((f) => f.functionName)))) ?? new Map<string, { qualifier: string; allocated: number }[]>();
    const specs = functions.flatMap((f): MetricQuerySpec<'invocations' | 'duration' | 'provisioned'>[] => {
      const base = { namespace: 'AWS/Lambda', period: DAY };
      const own = { ...base, ownerId: f.functionName, dimensions: [{ Name: 'FunctionName', Value: f.functionName }], stat: 'Sum' };
      return [
        { ...own, kind: 'invocations', metricName: 'Invocations' },
        { ...own, kind: 'duration', metricName: 'Duration' },
        ...(provisioned.get(f.functionName) ?? []).map((p) => ({
          ...base,
          ownerId: `${f.functionName}:${p.qualifier}`,
          kind: 'provisioned' as const,
          metricName: 'ProvisionedConcurrencyUtilization',
          dimensions: [
            { Name: 'FunctionName', Value: f.functionName },
            { Name: 'Resource', Value: `${f.functionName}:${p.qualifier}` },
          ],
          stat: 'Maximum',
        })),
      ];
    });
    const series = await this.cloudWatch.getMetricSeries(account, region, specs, METRICS_PERIOD_DAYS);
    const prices = await this.pricing.getLambdaPrices(region);
    const previous = new Map((await this.inventory.findByType(account.id, LAMBDA_FUNCTION_RESOURCE_TYPE)).map((r) => [r.arn, r.metadata]));
    await this.inventory.upsertDiscovered(
      account,
      functions.map((f) => ({ arn: f.arn, resourceId: f.arn, service: 'lambda', resourceType: LAMBDA_FUNCTION_RESOURCE_TYPE, region, name: f.functionName, tags: previous.get(f.arn)?.tags ?? {} })),
      seenAt,
    );
    const sum = (values: number[] | undefined): number => (values ?? []).reduce((a, b) => a + b, 0);
    for (const fn of functions) {
      const own = series.get(fn.functionName);
      const invocations = sum(own?.invocations?.values);
      await this.inventory.patchMetadata(account.id, LAMBDA_FUNCTION_RESOURCE_TYPE, fn.arn, {
        lambdaFunction: {
          fn,
          usage: { periodDays: METRICS_PERIOD_DAYS, invocations, durationMs: own?.duration?.values.length ? sum(own.duration.values) : null },
          provisioned: (provisioned.get(fn.functionName) ?? []).map((p) => {
            const values = series.get(`${fn.functionName}:${p.qualifier}`)?.provisioned?.values ?? [];
            return { ...p, peakUtilization: values.length ? Math.max(...values) : null, datapoints: values.length };
          }),
          prices,
          optimizer: previous.get(fn.arn)?.lambdaFunction?.optimizer ?? null,
        },
      });
    }
    this.logger.log({ msg: 'Lambda region enriched', awsAccountRef: account.id, region, functions: functions.length });
  }
}
