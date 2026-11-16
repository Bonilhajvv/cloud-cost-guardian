export interface MetricSumQuery {
  ownerId: string;
  namespace: string;
  metricName: string;
  dimensions: { Name: string; Value: string }[];
}
