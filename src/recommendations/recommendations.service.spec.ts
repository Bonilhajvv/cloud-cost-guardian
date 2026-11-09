import { ResourceAnalysis, RecommendationDraft } from '../aws/core/interfaces/recommendation-draft.interface';
import { RecommendationStatus, RecommendationType } from '../common/enums';
import { Recommendation } from './entities/recommendation.entity';
import { RecommendationsService } from './recommendations.service';

const analysis = (instanceType: string, memoryGb: number, target: string) =>
  ({
    kind: 'EC2',
    finding: 'RIGHTSIZE',
    current: { instanceType, vcpu: 2, memoryGb, monthlyCost: memoryGb * 7, costSource: 'ON_DEMAND_PRICE' },
    recommendation: { instanceType: target },
  }) as unknown as ResourceAnalysis;

const draft = (a: ResourceAnalysis, target: string) =>
  ({ resourceId: 'i-1', type: RecommendationType.EC2_RIGHTSIZING, targetKey: target, title: `to ${target}`, analysis: a }) as unknown as RecommendationDraft;

function build(existing: Partial<Recommendation>[]) {
  const saved: Recommendation[] = [];
  const repo = {
    find: jest.fn().mockResolvedValue(existing),
    create: jest.fn((v: Partial<Recommendation>) => ({ ...v }) as Recommendation),
    save: jest.fn(async (v: Recommendation | Recommendation[]) => {
      saved.push(...(Array.isArray(v) ? v : [v]));
      return v;
    }),
  };
  const service = new RecommendationsService(repo as never, {} as never);
  return { service, saved };
}

describe('RecommendationsService.syncDrafts', () => {
  const account = { id: 'acc-1', organizationId: 'org-1' } as never;

  it('resolves the old recommendation as CHANGED_DIFFERENTLY and opens a new one when the instance was upsized', async () => {
    const old = {
      id: 'rec-old',
      resourceId: 'i-1',
      type: RecommendationType.EC2_RIGHTSIZING,
      status: RecommendationStatus.OPEN,
      metadata: { analysis: analysis('t3a.medium', 4, 't3a.small'), targetKey: 't3a.small' },
    };
    const { service, saved } = build([old]);

    const result = await service.syncDrafts(account, [RecommendationType.EC2_RIGHTSIZING], [draft(analysis('t3a.large', 8, 't3a.medium'), 't3a.medium')], new Map());

    expect(result).toMatchObject({ resolved: 1, created: 1, updated: 0 });
    expect(saved[0]).toMatchObject({
      id: 'rec-old',
      status: RecommendationStatus.RESOLVED,
      metadata: { resolution: { reason: 'CHANGED_DIFFERENTLY', change: { from: 't3a.medium', to: 't3a.large', recommended: 't3a.small', size: 'LARGER' } } },
    });
    expect(saved[1]).toMatchObject({ status: RecommendationStatus.OPEN, title: 'to t3a.medium', metadata: { targetKey: 't3a.medium' } });
  });

  it('updates in place when the instance type did not change', async () => {
    const old = {
      resourceId: 'i-1',
      type: RecommendationType.EC2_RIGHTSIZING,
      status: RecommendationStatus.OPEN,
      metadata: { analysis: analysis('t3a.medium', 4, 't3a.small'), targetKey: 't3a.small' },
    };
    const { service } = build([old]);

    const result = await service.syncDrafts(account, [RecommendationType.EC2_RIGHTSIZING], [draft(analysis('t3a.medium', 4, 't3a.small'), 't3a.small')], new Map());

    expect(result).toMatchObject({ resolved: 0, created: 0, updated: 1 });
    expect(old.status).toBe(RecommendationStatus.OPEN);
  });

  it('records the resolution reason for recommendations missing from the scan', async () => {
    const old = {
      resourceId: 'i-1',
      type: RecommendationType.EC2_RIGHTSIZING,
      status: RecommendationStatus.OPEN,
      metadata: { analysis: analysis('t3a.medium', 4, 't3a.small') },
    };
    const { service } = build([old]);
    const current = { ...analysis('t3a.small', 2, 't3a.small'), finding: 'OPTIMIZED' } as ResourceAnalysis;

    const result = await service.syncDrafts(account, [RecommendationType.EC2_RIGHTSIZING], [], new Map([['i-1', current]]));

    expect(result.resolved).toBe(1);
    expect(old).toMatchObject({
      status: RecommendationStatus.IMPLEMENTED,
      statusChangedBy: null,
      realizedMonthlySavings: 14,
      metadata: { resolution: { reason: 'APPLIED' }, realizedSource: 'ON_DEMAND_PRICE' },
    });
    expect((old as Partial<Recommendation>).implementedAt).toBeInstanceOf(Date);
  });

  const accepted = (a: ResourceAnalysis) => ({
    resourceId: 'i-1',
    type: RecommendationType.EC2_RIGHTSIZING,
    status: RecommendationStatus.ACCEPTED,
    metadata: { analysis: a, targetKey: 't3a.small' },
  });

  it('keeps the accepted analysis frozen and stores the latest one apart', async () => {
    const frozen = analysis('t3a.medium', 4, 't3a.small');
    const rec = accepted(frozen);
    const { service } = build([rec]);
    const latest = analysis('t3a.medium', 4, 't3a.small');

    await service.syncDrafts(account, [RecommendationType.EC2_RIGHTSIZING], [draft(latest, 't3a.small')], new Map());

    expect(rec.status).toBe(RecommendationStatus.ACCEPTED);
    expect(rec.metadata.analysis).toBe(frozen);
    expect((rec.metadata as Record<string, unknown>).latestAnalysis).toBe(latest);
  });

  it('implements an accepted recommendation once the change shows up in a later scan', async () => {
    const rec = accepted(analysis('t3a.medium', 4, 't3a.small'));
    const { service } = build([rec]);
    const current = { ...analysis('t3a.small', 2, 't3a.small'), finding: 'OPTIMIZED' } as ResourceAnalysis;

    await service.syncDrafts(account, [RecommendationType.EC2_RIGHTSIZING], [], new Map([['i-1', current]]));

    expect(rec).toMatchObject({ status: RecommendationStatus.IMPLEMENTED, realizedMonthlySavings: 14 });
  });

  it('does not invent savings for an accepted recommendation whose analysis was already overwritten', async () => {
    const rec = accepted(analysis('t3a.small', 2, 't3a.small'));
    const { service } = build([rec]);
    const current = { ...analysis('t3a.small', 2, 't3a.small'), finding: 'OPTIMIZED' } as ResourceAnalysis;

    await service.syncDrafts(account, [RecommendationType.EC2_RIGHTSIZING], [], new Map([['i-1', current]]));

    expect(rec.status).toBe(RecommendationStatus.ACCEPTED);
    expect((rec as Partial<Recommendation>).realizedMonthlySavings).toBeUndefined();
  });

  it('keeps an accepted recommendation while the instance is stopped for the resize', async () => {
    const rec = accepted(analysis('t3a.medium', 4, 't3a.small'));
    const { service } = build([rec]);
    const stopped = { ...analysis('t3a.medium', 4, 't3a.small'), finding: 'NOT_RUNNING', recommendation: null } as unknown as ResourceAnalysis;

    const result = await service.syncDrafts(account, [RecommendationType.EC2_RIGHTSIZING], [], new Map([['i-1', stopped]]));

    expect(result.resolved).toBe(0);
    expect(rec.status).toBe(RecommendationStatus.ACCEPTED);
    expect((rec.metadata as Record<string, unknown>).latestAnalysis).toBe(stopped);
  });

  it('resolves without savings when the instance went below the recommendation and no longer fits', async () => {
    const old = {
      resourceId: 'i-1',
      type: RecommendationType.EC2_RIGHTSIZING,
      status: RecommendationStatus.OPEN,
      metadata: { analysis: analysis('t3a.medium', 4, 't3a.small') },
    };
    const { service } = build([old]);
    const micro = {
      ...analysis('t3a.micro', 1, 't3a.small'),
      finding: 'OPTIMIZED',
      options: [{ kind: 'CURRENT', instanceType: 't3a.micro', fit: 'DOES_NOT_FIT', projected: {}, notes: [] }],
    } as unknown as ResourceAnalysis;

    await service.syncDrafts(account, [RecommendationType.EC2_RIGHTSIZING], [], new Map([['i-1', micro]]));

    expect(old.status).toBe(RecommendationStatus.RESOLVED);
    expect((old as Partial<Recommendation>).realizedMonthlySavings).toBeUndefined();
  });
});
