export interface CostLine {
  periodStart: string;
  periodEnd: string;
  service: string | null;
  resourceId: string | null;
  amount: number;
  currency: string;
}

export interface CostForecast {
  periodStart: string;
  periodEnd: string;
  amount: number;
  currency: string;
}
