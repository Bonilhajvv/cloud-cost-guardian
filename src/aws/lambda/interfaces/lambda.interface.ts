import { LambdaOptimizerRecommendation } from '../../optimizer/interfaces/lambda-optimizer.interface';
import { LambdaArchitecture, LambdaPrices } from '../../pricing/interfaces/lambda-price.interface';

export interface LambdaProvisionedConcurrency {
  qualifier: string;
  allocated: number;
  peakUtilization: number | null;
  datapoints: number;
}

export interface LambdaFunction {
  functionName: string;
  arn: string;
  region: string;
  runtime: string | null;
  packageType: string;
  architecture: LambdaArchitecture;
  memoryMb: number;
}

export interface LambdaUsage {
  periodDays: number;
  invocations: number | null;
  durationMs: number | null;
}

export interface LambdaFunctionMetadata {
  fn: LambdaFunction;
  usage: LambdaUsage;
  provisioned: LambdaProvisionedConcurrency[];
  prices: LambdaPrices;
  optimizer?: LambdaOptimizerRecommendation | null;
}

export interface LambdaAnalyzerInput extends LambdaFunctionMetadata {
  currency: string;
  now?: Date;
}
