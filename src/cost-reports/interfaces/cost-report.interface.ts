export type ProjectionMethod = 'AWS_FORECAST' | 'LINEAR' | 'NONE';

export interface ServiceCost {
  service: string;
  amount: number;
}

export interface CostSummary {
  currency: string;
  monthStart: string;
  monthToDate: number;
  projectedMonthTotal: number | null;
  projectionMethod: ProjectionMethod;
  previousMonthTotal: number;
  variationPercent: number | null;
  byService: ServiceCost[];
}

export interface DailyCost {
  date: string;
  amount: number;
}

export interface MonthlyCost {
  month: string;
  amount: number;
}

export interface ResourceCost {
  awsAccountId: string;
  resourceId: string;
  service: string | null;
  last14DaysAmount: number;
  estimatedMonthlyCost: number;
}

export interface CostSyncSummary {
  monthlyLines: number;
  dailyLines: number;
  resourceLines: number;
  resourceLevelAvailable: boolean;
  forecastAvailable: boolean;
}
