import { HOURS_PER_MONTH } from '../../aws/pricing/constants/pricing.constant';
import { RouteHopUsageRow, RouteUsageRow } from '../interfaces/request-cost.interface';
import { allocateRouteCosts, clusterHourlyCost, requestUsageRows, workloadHourlyCosts, workloadKey } from './request-cost.helper';

const hour = new Date('2026-11-26T10:00:00Z');
const nextHour = new Date('2026-11-26T11:00:00Z');

const route = (entryRoute: string, requests: number, at = hour): RouteUsageRow => ({ hour: at, entryService: 'gateway', entryRoute, requests, durationMs: requests * 100 });

const hop = (entryRoute: string, name: string, durationMs: number, at = hour, extra: Partial<RouteHopUsageRow> = {}): RouteHopUsageRow => ({
  hour: at,
  entryService: 'gateway',
  entryRoute,
  hopKind: 'workload',
  namespace: 'shop',
  workloadKind: 'Deployment',
  workloadName: name,
  service: name,
  target: '',
  spans: 10,
  durationMs,
  ...extra,
});

describe('request cost helper', () => {
  it('returns null cluster cost when a node price is unknown', () => {
    expect(clusterHourlyCost([{ monthlyCost: 73, allocatableCpu: 2, allocatableMemoryBytes: 8 }, { monthlyCost: null, allocatableCpu: 2, allocatableMemoryBytes: 8 }])).toBeNull();
    expect(clusterHourlyCost([{ monthlyCost: HOURS_PER_MONTH, allocatableCpu: 2, allocatableMemoryBytes: 8 }])).toBe(1);
  });

  it('splits node cost by the max of requests and usage over CPU and memory', () => {
    const costs = workloadHourlyCosts(
      [{ monthlyCost: HOURS_PER_MONTH * 10, allocatableCpu: 4, allocatableMemoryBytes: 100 }],
      [
        { namespace: 'shop', kind: 'Deployment', name: 'a', requestsCpu: 1, requestsMemoryBytes: 25, usageCpu: 2, usageMemoryBytes: 10 },
        { namespace: 'shop', kind: 'Deployment', name: 'none', requestsCpu: null, requestsMemoryBytes: null, usageCpu: null, usageMemoryBytes: null },
      ],
    );
    expect(costs.get(workloadKey('shop', 'Deployment', 'a'))).toBeCloseTo(10 * ((2 / 4 + 25 / 100) / 2));
    expect(costs.get(workloadKey('shop', 'Deployment', 'none'))).toBeNull();
  });

  it('splits each workload hour among routes by span time and sums the chain', () => {
    const costs = new Map<string, number | null>([
      [workloadKey('shop', 'Deployment', 'orders'), 2],
      [workloadKey('shop', 'Deployment', 'payments'), 1],
    ]);
    const result = allocateRouteCosts(
      [route('POST /checkout', 100), route('GET /orders', 300), route('POST /checkout', 50, nextHour)],
      [
        hop('POST /checkout', 'orders', 300),
        hop('GET /orders', 'orders', 100),
        hop('POST /checkout', 'payments', 500),
        hop('POST /checkout', 'orders', 50, nextHour),
        hop('POST /checkout', '', 10, hour, { hopKind: 'external', namespace: '', workloadKind: '', workloadName: '', service: 'payments', target: 'postgresql://db', spans: 7, durationMs: 40 }),
      ],
      costs,
    );
    const checkout = result.find((r) => r.entryRoute === 'POST /checkout')!;
    const orders = result.find((r) => r.entryRoute === 'GET /orders')!;
    expect(checkout.requests).toBe(150);
    expect(checkout.workloads.find((w) => w.name === 'orders')!.cost).toBeCloseTo(2 * 0.75 + 2 * 1);
    expect(checkout.workloads.find((w) => w.name === 'payments')!.cost).toBeCloseTo(1);
    expect(checkout.cost).toBeCloseTo(4.5);
    expect(checkout.costPerRequest).toBeCloseTo(4.5 / 150);
    expect(checkout.externals).toEqual([{ service: 'payments', target: 'postgresql://db', calls: 7, durationMs: 40, cost: null }]);
    expect(orders.cost).toBeCloseTo(0.5);
    expect(result[0].entryRoute).toBe('POST /checkout');
  });

  it('keeps the route cost null when one workload has no known price', () => {
    const result = allocateRouteCosts(
      [route('GET /x', 10)],
      [hop('GET /x', 'priced', 100), hop('GET /x', 'unpriced', 100), hop('GET /x', '', 100, hour, { workloadKind: '', service: 'legacy' })],
      new Map([[workloadKey('shop', 'Deployment', 'priced'), 1]]),
    );
    expect(result[0].cost).toBeNull();
    expect(result[0].costPerRequest).toBeNull();
    expect(result[0].knownCost).toBeCloseTo(1);
    expect(result[0].workloads.filter((w) => w.cost === null)).toHaveLength(2);
  });

  it('scales sampled counts, buckets by the window end hour and merges duplicate keys', () => {
    const hopIn = { kind: 'workload' as const, namespace: 'shop', workloadKind: 'Deployment', workloadName: 'orders', service: 'orders', spans: 3, durationMs: 30 };
    const { routes, hops } = requestUsageRows({
      windowStart: '2026-11-26T10:55:00Z',
      windowEnd: '2026-11-26T11:00:30Z',
      sampleRatio: 0.5,
      droppedTraces: 0,
      routes: [
        { entryService: 'gw', entryRoute: 'GET /a', requests: 5, durationMs: 50, hops: [hopIn, hopIn, { kind: 'external', service: 'orders', target: 'redis://cache', spans: 1, durationMs: 2 }] },
        { entryService: 'gw', entryRoute: 'GET /a', requests: 1, durationMs: 10, hops: [] },
      ],
    });
    expect(routes).toEqual([{ hour: new Date('2026-11-26T11:00:00Z'), entryService: 'gw', entryRoute: 'GET /a', requests: 12, durationMs: 120 }]);
    expect(hops).toHaveLength(2);
    expect(hops[0]).toMatchObject({ workloadName: 'orders', spans: 12, durationMs: 120, target: '' });
    expect(hops[1]).toMatchObject({ hopKind: 'external', namespace: '', target: 'redis://cache', spans: 2 });
  });
});
