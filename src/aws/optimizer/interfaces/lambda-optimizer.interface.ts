import { OptimizerAvailability } from './ec2-optimizer.interface';

export interface LambdaOptimizerOption {
  memoryMb: number;
  rank: number | null;
  estimatedMonthlySavings: number | null;
}

export interface LambdaOptimizerRecommendation {
  functionArn: string;
  functionName: string;
  currentMemoryMb: number;
  finding: string;
  reasonCodes: string[];
  options: LambdaOptimizerOption[];
}

export interface LambdaOptimizerResult {
  availability: OptimizerAvailability;
  recommendations: LambdaOptimizerRecommendation[];
}
