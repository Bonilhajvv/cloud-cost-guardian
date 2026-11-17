import { Level, RecommendationType } from '../../../common/enums';
import { effectiveWorkSchedule, formatDays } from '../../../organizations/helpers/work-schedule.helper';
import { resolutionFor, resolutionOutcome } from '../../../recommendations/helpers/resolution.helper';
import { detectEnvironment } from '../../core/helpers/environment.helper';
import { EnvironmentInfo } from '../../core/interfaces/environment.interface';
import { Ec2InstanceDetails } from '../interfaces/ec2-instance.interface';
import { Ec2Analysis } from '../interfaces/ec2-analysis.interface';
import { scheduleDraft, schedulerTag } from './schedule.helper';

const instance = (overrides: Partial<Ec2InstanceDetails> = {}): Ec2InstanceDetails =>
  ({ instanceId: 'i-1', arn: 'arn:aws:ec2:us-east-1:1:instance/i-1', name: 'api-hml', instanceType: 'm5.large', state: 'running', tags: {}, ...overrides }) as Ec2InstanceDetails;

const analysis = (environment: EnvironmentInfo, overrides: Partial<Ec2Analysis> = {}): Ec2Analysis =>
  ({
    kind: 'EC2',
    resourceId: 'i-1',
    resourceArn: 'arn:aws:ec2:us-east-1:1:instance/i-1',
    name: 'api-hml',
    region: 'us-east-1',
    finding: 'OPTIMIZED',
    kubernetes: null,
    environment,
    scheduler: null,
    current: { instanceType: 'm5.large', vcpu: 2, memoryGb: 8, monthlyCost: 100, costSource: 'ON_DEMAND_PRICE' },
    recommendation: null,
    reduction: null,
    savings: null,
    analyzedAt: '2026-11-17T00:00:00Z',
    ...overrides,
  }) as Ec2Analysis;

const HML = detectEnvironment('api-hml', {});
const DEFAULT = effectiveWorkSchedule(null);

describe('detectEnvironment', () => {
  it.each([
    ['api', { Environment: 'hml' }, null, 'NON_PRODUCTION', 'TAG'],
    ['api-hml', { Environment: 'prd' }, null, 'PRODUCTION', 'TAG'],
    ['api', { ambiente: 'blue' }, null, 'UNKNOWN', 'TAG'],
    ['orders-prod-01', {}, null, 'PRODUCTION', 'NAME'],
    ['orders_qa', {}, null, 'NON_PRODUCTION', 'NAME'],
    ['test-prd-db', {}, null, 'UNKNOWN', 'NAME'],
    ['devices', {}, null, 'UNKNOWN', null],
    ['devices', { Environment: 'prd' }, 'NON_PRODUCTION', 'NON_PRODUCTION', 'MANUAL'],
  ] as const)('%s %j override=%s', (name, tags, override, environment, source) => {
    expect(detectEnvironment(name, tags, override)).toMatchObject({ environment, source });
  });
});

describe('work schedule', () => {
  it('defaults to Mon-Fri 08-20, 60 hours a week', () => {
    expect(DEFAULT).toMatchObject({ days: [1, 2, 3, 4, 5], startHour: 8, endHour: 20, hoursPerWeek: 60, isDefault: true });
    expect(formatDays([1, 2, 3, 4, 5])).toBe('Mon-Fri');
    expect(formatDays([1, 3, 6])).toBe('Mon, Wed, Sat');
  });
});

describe('scheduleDraft', () => {
  it('stops a running non-production instance outside business hours', () => {
    const draft = scheduleDraft(analysis(HML), instance(), DEFAULT, 'USD');
    expect(draft).toMatchObject({
      type: RecommendationType.EC2_SCHEDULE,
      title: 'Stop api-hml outside business hours (Mon-Fri 08:00-20:00)',
      estimatedMonthlySavings: 64.29,
      recommendedMonthlyCost: 35.71,
      risk: Level.LOW,
      confidence: Level.MEDIUM,
      targetKey: '12345-8-20',
    });
    expect(draft?.description).toContain('60h of 168h per week, about 64% less instance cost');
    expect(draft?.description).toContain('name contains "hml"');
  });

  it('uses the organization schedule and trusts tags and manual marks more than names', () => {
    const schedule = effectiveWorkSchedule({ days: [1, 2, 3, 4, 5, 6], startHour: 7, endHour: 19, timezone: 'UTC' });
    const draft = scheduleDraft(analysis(detectEnvironment('api', {}, 'NON_PRODUCTION')), instance({ name: 'api' }), schedule, 'USD');
    expect(draft).toMatchObject({ estimatedMonthlySavings: 57.14, confidence: Level.HIGH });
  });

  it('skips production, unknown, stopped, Kubernetes, Auto Scaling and already scheduled instances', () => {
    expect(scheduleDraft(analysis(detectEnvironment('api-prd', {})), instance(), DEFAULT, 'USD')).toBeNull();
    expect(scheduleDraft(analysis(detectEnvironment('api', {})), instance(), DEFAULT, 'USD')).toBeNull();
    expect(scheduleDraft(analysis(HML), instance({ state: 'stopped' }), DEFAULT, 'USD')).toBeNull();
    expect(scheduleDraft(analysis(HML, { kubernetes: { cluster: 'c' } as Ec2Analysis['kubernetes'] }), instance(), DEFAULT, 'USD')).toBeNull();
    expect(scheduleDraft(analysis(HML), instance({ tags: { 'aws:autoscaling:groupName': 'asg' } }), DEFAULT, 'USD')).toBeNull();
    expect(scheduleDraft(analysis(HML, { scheduler: 'Schedule=office' }), instance(), DEFAULT, 'USD')).toBeNull();
  });

  it('keeps the recommendation with unknown savings when the price is missing, and drops tiny savings', () => {
    const unknown = analysis(HML, { current: { instanceType: 't3.nano', vcpu: 2, memoryGb: 0.5, monthlyCost: null, costSource: 'UNAVAILABLE' } });
    expect(scheduleDraft(unknown, instance(), DEFAULT, 'USD')).toMatchObject({ estimatedMonthlySavings: null });
    const cheap = analysis(HML, { current: { instanceType: 't3.nano', vcpu: 2, memoryGb: 0.5, monthlyCost: 3.8, costSource: 'ON_DEMAND_PRICE' } });
    expect(scheduleDraft(cheap, instance(), DEFAULT, 'USD')).toBeNull();
  });

  it('marks the recommendation implemented once a scheduler tag shows up', () => {
    expect(schedulerTag({ Schedule: 'office-hours' })).toBe('Schedule=office-hours');
    expect(schedulerTag({ Schedule: '' })).toBeNull();
    const previous = scheduleDraft(analysis(HML), instance(), DEFAULT, 'USD')!.analysis;
    const current = analysis(HML, { scheduler: 'Schedule=office-hours', finding: 'NOT_RUNNING' });
    const resolution = resolutionFor(previous, current);
    expect(resolution.reason).toBe('APPLIED');
    expect(resolutionOutcome(RecommendationType.EC2_SCHEDULE, previous, current, resolution, 100)).toEqual({ implemented: true, realized: null });
    const removed = resolutionFor(previous, analysis(HML));
    expect(resolutionOutcome(RecommendationType.EC2_SCHEDULE, previous, analysis(HML), removed, 100).implemented).toBe(false);
  });
});
