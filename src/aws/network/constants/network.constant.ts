export const IDLE_NAT_MAX_GB = 1;

export const NETWORK_MIN_AGE_DAYS = 7;

export const GATEWAY_ENDPOINT_SERVICES = ['s3', 'dynamodb'];

export const LOAD_BALANCER_PRICING_FAMILIES: Record<string, string> = {
  application: 'Load Balancer-Application',
  network: 'Load Balancer-Network',
};

export const LOAD_BALANCER_METRICS: Record<string, { namespace: string; metricName: string }> = {
  application: { namespace: 'AWS/ApplicationELB', metricName: 'RequestCount' },
  network: { namespace: 'AWS/NetworkELB', metricName: 'NewFlowCount' },
};

export const GIB_BYTES = 1024 ** 3;
