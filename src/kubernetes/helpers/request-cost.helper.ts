import { HOURS_PER_MONTH } from '../../aws/pricing/constants/pricing.constant';
import { round } from '../../common/helpers/stats.helper';
import { MS_PER_HOUR, REQUEST_COST_DECIMALS } from '../constants/request-cost.constant';
import { RequestUsageDto } from '../dto/agent-report.dto';
import { CostNode, CostWorkload, ExternalHopCost, RouteCost, RouteHopUsageRow, RouteKeyRow, RouteUsageRow, WorkloadHopCost } from '../interfaces/request-cost.interface';

export const startOfHour = (date: Date): Date => new Date(Math.floor(date.getTime() / MS_PER_HOUR) * MS_PER_HOUR);

export const workloadKey = (namespace: string, kind: string, name: string): string => `${namespace}/${kind}/${name}`;

const routeKey = (r: RouteKeyRow): string => `${r.entryService}\u0000${r.entryRoute}`;

const share = (used: number, total: number | null): number | null => (total && total > 0 ? used / total : null);

export function clusterHourlyCost(nodes: CostNode[]): number | null {
  if (nodes.length === 0 || nodes.some((n) => n.monthlyCost === null)) return null;
  return nodes.reduce((s, n) => s + (n.monthlyCost ?? 0), 0) / HOURS_PER_MONTH;
}

export function workloadHourlyCosts(nodes: CostNode[], workloads: CostWorkload[]): Map<string, number | null> {
  const hourly = clusterHourlyCost(nodes);
  const sum = (values: (number | null)[]): number | null => (values.some((v) => v === null) ? null : values.reduce<number>((s, v) => s + (v ?? 0), 0));
  const allocCpu = sum(nodes.map((n) => n.allocatableCpu));
  const allocMemory = sum(nodes.map((n) => n.allocatableMemoryBytes));
  return new Map(
    workloads.map((w) => {
      const cpu = Math.max(w.requestsCpu ?? 0, w.usageCpu ?? 0);
      const memory = Math.max(w.requestsMemoryBytes ?? 0, w.usageMemoryBytes ?? 0);
      const shares = [share(cpu, allocCpu), share(memory, allocMemory)].filter((s): s is number => s !== null);
      const cost = hourly === null || shares.length === 0 || cpu + memory === 0 ? null : (hourly * shares.reduce((s, v) => s + v, 0)) / shares.length;
      return [workloadKey(w.namespace, w.kind, w.name), cost];
    }),
  );
}

export function allocateRouteCosts(routes: RouteUsageRow[], hops: RouteHopUsageRow[], hourlyCosts: ReadonlyMap<string, number | null>): RouteCost[] {
  const workloadHops = hops.filter((h) => h.hopKind === 'workload');
  const hourTotals = new Map<string, number>();
  for (const h of workloadHops) {
    const k = `${h.hour.getTime()}|${workloadKey(h.namespace, h.workloadKind, h.workloadName)}`;
    hourTotals.set(k, (hourTotals.get(k) ?? 0) + h.durationMs);
  }

  const out = new Map<string, RouteCost & { durationMs: number; byWorkload: Map<string, WorkloadHopCost & { hours: number }>; byExternal: Map<string, ExternalHopCost> }>();
  const routeFor = (r: RouteKeyRow) => {
    const k = routeKey(r);
    let route = out.get(k);
    if (!route) {
      route = {
        entryService: r.entryService,
        entryRoute: r.entryRoute,
        requests: 0,
        durationMs: 0,
        avgDurationMs: null,
        cost: null,
        knownCost: 0,
        costPerRequest: null,
        workloads: [],
        externals: [],
        byWorkload: new Map(),
        byExternal: new Map(),
      };
      out.set(k, route);
    }
    return route;
  };

  for (const r of routes) {
    const route = routeFor(r);
    route.requests += r.requests;
    route.durationMs += r.durationMs;
  }

  for (const h of hops) {
    const route = routeFor(h);
    if (h.hopKind === 'workload') {
      const key = workloadKey(h.namespace, h.workloadKind, h.workloadName);
      const entry = route.byWorkload.get(`${key}|${h.service}`) ?? {
        namespace: h.namespace,
        kind: h.workloadKind,
        name: h.workloadName,
        service: h.service,
        spans: 0,
        durationMs: 0,
        hourlyCost: h.workloadName ? (hourlyCosts.get(key) ?? null) : null,
        cost: null,
        hours: 0,
      };
      const total = hourTotals.get(`${h.hour.getTime()}|${key}`) ?? 0;
      entry.spans += h.spans;
      entry.durationMs += h.durationMs;
      entry.hours += total > 0 ? h.durationMs / total : 0;
      route.byWorkload.set(`${key}|${h.service}`, entry);
    } else {
      const k = `${h.service}|${h.target}`;
      const entry = route.byExternal.get(k) ?? { service: h.service, target: h.target, calls: 0, durationMs: 0, cost: null };
      entry.calls += h.spans;
      entry.durationMs += h.durationMs;
      route.byExternal.set(k, entry);
    }
  }

  return [...out.values()]
    .map(({ byWorkload, byExternal, durationMs, ...route }) => {
      const workloads = [...byWorkload.values()]
        .map(({ hours, ...w }) => ({
          ...w,
          durationMs: round(w.durationMs),
          hourlyCost: w.hourlyCost === null ? null : round(w.hourlyCost, REQUEST_COST_DECIMALS),
          cost: w.hourlyCost === null ? null : round(w.hourlyCost * hours, REQUEST_COST_DECIMALS),
        }))
        .sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1) || b.durationMs - a.durationMs);
      const knownCost = round(workloads.reduce((s, w) => s + (w.cost ?? 0), 0), REQUEST_COST_DECIMALS);
      const complete = workloads.length > 0 && workloads.every((w) => w.cost !== null);
      const cost = complete ? knownCost : null;
      return {
        ...route,
        avgDurationMs: route.requests > 0 ? round(durationMs / route.requests) : null,
        cost,
        knownCost,
        costPerRequest: cost !== null && route.requests > 0 ? round(cost / route.requests, REQUEST_COST_DECIMALS) : null,
        workloads,
        externals: [...byExternal.values()].map((e) => ({ ...e, durationMs: round(e.durationMs) })).sort((a, b) => b.durationMs - a.durationMs),
      };
    })
    .sort((a, b) => (b.cost ?? b.knownCost) - (a.cost ?? a.knownCost) || b.requests - a.requests);
}

export function requestUsageRows(usage: RequestUsageDto): { routes: RouteUsageRow[]; hops: RouteHopUsageRow[] } {
  const hour = startOfHour(new Date(usage.windowEnd));
  const scale = 1 / usage.sampleRatio;
  const routes = new Map<string, RouteUsageRow>();
  const hops = new Map<string, RouteHopUsageRow>();
  for (const r of usage.routes) {
    const route = routes.get(routeKey({ ...r, hour })) ?? { hour, entryService: r.entryService, entryRoute: r.entryRoute, requests: 0, durationMs: 0 };
    route.requests += Math.round(r.requests * scale);
    route.durationMs += r.durationMs * scale;
    routes.set(routeKey(route), route);
    for (const h of r.hops) {
      const row: RouteHopUsageRow = {
        hour,
        entryService: r.entryService,
        entryRoute: r.entryRoute,
        hopKind: h.kind,
        namespace: h.namespace ?? '',
        workloadKind: h.workloadKind ?? '',
        workloadName: h.workloadName ?? '',
        service: h.service ?? '',
        target: h.target ?? '',
        spans: 0,
        durationMs: 0,
      };
      const key = [routeKey(row), row.hopKind, row.namespace, row.workloadKind, row.workloadName, row.service, row.target].join('\u0000');
      const hop = hops.get(key) ?? row;
      hop.spans += Math.round(h.spans * scale);
      hop.durationMs += h.durationMs * scale;
      hops.set(key, hop);
    }
  }
  return { routes: [...routes.values()], hops: [...hops.values()] };
}
