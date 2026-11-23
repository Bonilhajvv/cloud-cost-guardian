import { RecommendationType } from '../../common/enums';
import { addDays, toIsoDate } from '../../common/helpers/date.helper';
import { DailyUsage } from '../../cost-reports/interfaces/cost-usage.interface';
import { measureRealizedSavings, usageKeysOf } from './realized-savings.helper';

const implementedAt = new Date('2026-10-01T15:00:00Z');
const day = (offset: number) => toIsoDate(addDays(implementedAt, offset));
const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => day(from + i));
const usage = (list: string[], over: Partial<DailyUsage>): DailyUsage[] => list.map((d) => ({ day: d, cost: 0, hours: 0, hourlyCost: 0, ...over }));
const covered = days(-40, 40);
const now = addDays(implementedAt, 45);
const measure = (type: RecommendationType, rows: DailyUsage[], over: object = {}) => measureRealizedSavings({ type, implementedAt, coveredDays: covered, usage: rows, now, ...over });

describe('measureRealizedSavings', () => {
  it('compares the hourly rate and ignores that the instance ran fewer hours', () => {
    const rows = [...usage(days(-40, 0), { cost: 2.4, hours: 24, hourlyCost: 2.4 }), ...usage(days(1, 40), { cost: 0.6, hours: 12, hourlyCost: 0.6 })];
    expect(measure(RecommendationType.EC2_RIGHTSIZING, rows)).toMatchObject({ status: 'MEASURED', amount: 18.24, beforeDays: 30, afterDays: 30, final: true });
  });

  it('counts a removed resource as zero after the change', () => {
    expect(measure(RecommendationType.EBS_UNUSED, usage(days(-40, 0), { cost: 1 }))).toMatchObject({ status: 'MEASURED', amount: 30.4 });
  });

  it('reports a negative amount when the cost went up', () => {
    const rows = [...usage(days(-40, 0), { cost: 1 }), ...usage(days(1, 40), { cost: 2 })];
    expect(measure(RecommendationType.RDS_MULTI_AZ, rows).amount).toBe(-30.4);
  });

  it('does not measure a resource recreated with another id', () => {
    expect(measure(RecommendationType.RDS_MULTI_AZ, usage(days(-40, 0), { cost: 1 }))).toMatchObject({ status: 'NOT_MEASURABLE', amount: null });
  });

  it('waits for 7 settled days after the change', () => {
    const rows = [...usage(days(-40, 0), { cost: 1 }), ...usage(days(1, 8), { cost: 0.5 })];
    expect(measure(RecommendationType.EBS_OPTIMIZATION, rows, { now: addDays(implementedAt, 8) })).toMatchObject({ status: 'PENDING', amount: null, afterDays: 6, final: false });
    expect(measure(RecommendationType.EBS_OPTIMIZATION, rows, { now: addDays(implementedAt, 9) })).toMatchObject({ status: 'MEASURED', amount: 15.2, afterDays: 7, final: false });
  });

  it('does not measure without 7 days before, counting from the first cost of the resource', () => {
    expect(measure(RecommendationType.EBS_UNUSED, usage(days(-6, 0), { cost: 1 }))).toMatchObject({ status: 'NOT_MEASURABLE', beforeDays: 5 });
    expect(measure(RecommendationType.EBS_UNUSED, [])).toMatchObject({ status: 'NOT_MEASURABLE', amount: null });
  });

  it('never credits the same saving twice when two changes hit the resource', () => {
    const rows = [...usage(days(-40, 0), { cost: 3 }), ...usage(days(1, 20), { cost: 2 }), ...usage(days(21, 40), { cost: 1 })];
    expect(measure(RecommendationType.RDS_MULTI_AZ, rows, { otherChanges: [implementedAt] })).toMatchObject({ status: 'NOT_MEASURABLE', amount: null });
    expect(measure(RecommendationType.RDS_MULTI_AZ, rows, { otherChanges: [addDays(implementedAt, 20)] })).toMatchObject({ amount: 30.4, afterDays: 18, final: true });
    expect(measure(RecommendationType.RDS_STORAGE_TYPE, rows, { implementedAt: addDays(implementedAt, 20), otherChanges: [implementedAt] })).toMatchObject({ amount: 30.4, beforeDays: 18 });
  });

  it('measures a first Savings Plan by its net benefit', () => {
    expect(measure(RecommendationType.SAVINGS_PLAN_PURCHASE, usage(days(1, 40), { cost: -10 }))).toMatchObject({ status: 'MEASURED', amount: 304 });
  });
});

describe('usageKeysOf', () => {
  const rec = (type: RecommendationType, resourceId: string, resourceArn: string | null, metadata: object = {}) => usageKeysOf({ type, resourceId, resourceArn, metadata } as never);

  it('never matches by a name that another service may reuse', () => {
    expect(rec(RecommendationType.RDS_MULTI_AZ, 'logs', 'arn:aws:rds:us-east-1:1:db:logs')).toEqual(['arn:aws:rds:us-east-1:1:db:logs']);
    expect(rec(RecommendationType.EC2_IDLE, 'i-0abc', 'arn:ec2')).toEqual(['arn:ec2', 'i-0abc']);
  });

  it('uses the volumes of a stopped instance and the account key of commitments', () => {
    expect(rec(RecommendationType.EC2_STOPPED, 'i-1', null, { analysis: { kind: 'EC2', stoppedVolumes: [{ volumeId: 'vol-1', monthlyCost: 1 }] } })).toEqual(['vol-1']);
    expect(rec(RecommendationType.SAVINGS_PLAN_PURCHASE, 'sp', null)).toEqual(['ccg:savings-plans']);
  });
});
