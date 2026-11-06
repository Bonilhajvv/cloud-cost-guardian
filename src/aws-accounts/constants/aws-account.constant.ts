export const AWS_REGION_PATTERN = /^[a-z]{2}(-gov)?-[a-z]+-\d$/;

export const ROLE_ARN_PATTERN = /^arn:aws(-cn|-us-gov)?:iam::\d{12}:role\/[\w+=,.@\/-]{1,512}$/;

export const SUGGESTED_ROLE_NAME = 'CloudCostGuardianReadOnly';

export const CFN_STACK_NAME = 'CloudCostGuardian';

export const CFN_CONSOLE_REGION = 'us-east-1';

export const CFN_TEMPLATE_PUBLIC_PATH = '/api/v1/public/cloudformation/readonly-role.json';

export const READ_ONLY_ACTIONS = [
  'resource-explorer-2:ListIndexes',
  'resource-explorer-2:ListResources',
  'resource-explorer-2:Search',
  'resource-explorer-2:GetIndex',
  'resource-explorer-2:GetDefaultView',
  'ec2:DescribeInstances',
  'ec2:DescribeInstanceTypes',
  'ec2:DescribeRegions',
  'ec2:DescribeVolumes',
  'cloudwatch:GetMetricData',
  'cloudwatch:ListMetrics',
  'ce:GetCostAndUsage',
  'ce:GetCostAndUsageWithResources',
  'ce:GetCostForecast',
  'compute-optimizer:GetEC2InstanceRecommendations',
  'compute-optimizer:GetEnrollmentStatus',
] as const;
