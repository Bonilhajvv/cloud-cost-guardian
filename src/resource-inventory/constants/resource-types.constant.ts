export const EC2_INSTANCE_RESOURCE_TYPE = 'ec2:instance';

export const EBS_VOLUME_RESOURCE_TYPE = 'ec2:volume';

export const RDS_DB_INSTANCE_RESOURCE_TYPE = 'rds:db';

export const AURORA_CLUSTER_RESOURCE_TYPE = 'rds:cluster';

export const S3_BUCKET_RESOURCE_TYPE = 's3:bucket';

export const LAMBDA_FUNCTION_RESOURCE_TYPE = 'lambda:function';

export const NETWORK_RESOURCE_TYPES = {
  EIP: 'ec2:elastic-ip',
  NAT: 'ec2:natgateway',
  LB: 'elasticloadbalancing:loadbalancer',
  VPC: 'ec2:vpc',
} as const;

export const SNAPSHOT_RESOURCE_TYPES = {
  EBS: 'ec2:snapshot',
  RDS: 'rds:snapshot',
} as const;

export const UPSERT_CHUNK_SIZE = 500;

export const MEMORY_COVERAGE_HINT =
  'Connect your Kubernetes cluster (one kubectl command), install the CloudWatch Agent or enable Container Insights to measure memory';
