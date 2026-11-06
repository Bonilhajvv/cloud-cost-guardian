import { InstanceTypeSpec } from '../../ec2/interfaces/ec2-instance.interface';

export type Ec2OptimizerFinding =
  | 'OVER_PROVISIONED'
  | 'UNDER_PROVISIONED'
  | 'OPTIMIZED'
  | 'NOT_OPTIMIZED'
  | 'UNKNOWN';

export interface Ec2OptimizerOption {
  instanceType: string;
  rank: number | null;
  performanceRisk: number | null;
  estimatedMonthlySavings: number | null;
  savingsPercentage: number | null;
  currency: string;
  spec: InstanceTypeSpec | null;
}

export interface Ec2OptimizerRecommendation {
  instanceArn: string;
  instanceId: string;
  currentInstanceType: string;
  finding: Ec2OptimizerFinding;
  lookBackPeriodDays: number | null;
  lastRefreshedAt: string | null;
  options: Ec2OptimizerOption[];
}

export type OptimizerAvailability = 'OK' | 'NOT_ENROLLED' | 'ACCESS_DENIED';

export interface Ec2OptimizerResult {
  availability: OptimizerAvailability;
  recommendations: Ec2OptimizerRecommendation[];
}
