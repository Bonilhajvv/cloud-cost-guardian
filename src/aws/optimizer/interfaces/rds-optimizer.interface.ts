import { Ec2OptimizerFinding, OptimizerAvailability } from './ec2-optimizer.interface';

export interface RdsOptimizerOption {
  instanceClass: string;
  rank: number | null;
  performanceRisk: number | null;
  estimatedMonthlySavings: number | null;
}

export interface RdsOptimizerRecommendation {
  resourceArn: string;
  dbInstanceId: string;
  currentInstanceClass: string;
  finding: Ec2OptimizerFinding;
  idle: boolean | null;
  lookBackPeriodDays: number | null;
  options: RdsOptimizerOption[];
  utilization: Record<string, number>;
}

export interface RdsOptimizerResult {
  availability: OptimizerAvailability;
  recommendations: RdsOptimizerRecommendation[];
}
