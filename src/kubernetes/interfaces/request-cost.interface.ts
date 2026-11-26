export interface RouteKeyRow {
  hour: Date;
  entryService: string;
  entryRoute: string;
}

export interface RouteUsageRow extends RouteKeyRow {
  requests: number;
  durationMs: number;
}

export interface RouteHopUsageRow extends RouteKeyRow {
  hopKind: string;
  namespace: string;
  workloadKind: string;
  workloadName: string;
  service: string;
  target: string;
  spans: number;
  durationMs: number;
}

export interface CostNode {
  monthlyCost: number | null;
  allocatableCpu: number | null;
  allocatableMemoryBytes: number | null;
}

export interface CostWorkload {
  namespace: string;
  kind: string;
  name: string;
  requestsCpu: number | null;
  requestsMemoryBytes: number | null;
  usageCpu: number | null;
  usageMemoryBytes: number | null;
}

export interface WorkloadHopCost {
  namespace: string;
  kind: string;
  name: string;
  service: string;
  spans: number;
  durationMs: number;
  hourlyCost: number | null;
  cost: number | null;
}

export interface ExternalHopCost {
  service: string;
  target: string;
  calls: number;
  durationMs: number;
  cost: null;
}

export interface RouteCost {
  entryService: string;
  entryRoute: string;
  requests: number;
  avgDurationMs: number | null;
  cost: number | null;
  knownCost: number;
  costPerRequest: number | null;
  workloads: WorkloadHopCost[];
  externals: ExternalHopCost[];
}

export interface RequestCostReport {
  clusterId: string;
  from: string;
  to: string;
  currency: string;
  clusterHourlyCost: number | null;
  routes: RouteCost[];
  notes: string[];
}
