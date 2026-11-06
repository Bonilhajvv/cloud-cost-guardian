export interface MetricsCoverage {
  ec2Running: number;
  memory: { cloudwatchAgent: number; containerInsights: number; kubernetesAgent: number; unavailable: number };
  disk: { available: number; unavailable: number };
  ebs: { volumes: number; unattached: number; gp2: number };
  hint: string | null;
}
