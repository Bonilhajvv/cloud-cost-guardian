export const MAX_REPORT_ROUTES = 1000;

export const MAX_ROUTE_HOPS = 250;

export const HOP_KINDS = ['workload', 'external'] as const;

export const REQUEST_COST_DEFAULT_HOURS = 24;

export const REQUEST_COST_MAX_DAYS = 30;

export const MS_PER_HOUR = 60 * 60 * 1000;

export const REQUEST_COST_DECIMALS = 8;

export const REQUEST_COST_NOTES = {
  workloadCost: 'Workload cost is the worker nodes EC2 cost split by each workload share of CPU and memory, using max(requests, usage) from the latest agent report',
  routeSplit: 'In each hour a workload cost is split among the routes that reached it by the time their server spans took there; untraced traffic is not counted, so traced routes absorb the whole workload cost',
  externals: 'Calls to databases, queues and third-party APIs are counted with their time, but are not priced yet',
  idle: 'Node capacity that no workload requests or uses is not assigned to any route',
  sampling: 'Request counts are scaled by the sample ratio the agent reports',
} as const;
