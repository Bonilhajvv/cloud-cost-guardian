import { ResourceAnalysis } from '../../aws/core/interfaces/recommendation-draft.interface';
import { RecommendationType } from '../../common/enums';
import { resolutionFor, resolutionOutcome, typeChanged } from './resolution.helper';

const ec2 = (instanceType: string, finding: string, extra: Record<string, unknown> = {}) =>
  ({
    kind: 'EC2',
    finding,
    current: { instanceType, ...SPECS[instanceType] },
    recommendation: null,
    options: [],
    ...extra,
  }) as unknown as ResourceAnalysis;

const SPECS: Record<string, { vcpu: number; memoryGb: number; monthlyCost: number }> = {
  't3a.medium': { vcpu: 2, memoryGb: 4, monthlyCost: 27.45 },
  't3a.small': { vcpu: 2, memoryGb: 2, monthlyCost: 13.72 },
  't3a.micro': { vcpu: 2, memoryGb: 1, monthlyCost: 6.86 },
  't3a.large': { vcpu: 2, memoryGb: 8, monthlyCost: 54.9 },
  'c6a.large': { vcpu: 2, memoryGb: 4, monthlyCost: 55.85 },
};

const ebs = (volumeType: string, finding: string, targetVolumeType: string | null = null) =>
  ({
    kind: 'EBS',
    finding,
    current: { volumeType, sizeGiB: 12, monthlyCost: volumeType === 'gp2' ? 1.2 : 0.96 },
    recommendation: targetVolumeType ? { targetVolumeType } : null,
  }) as unknown as ResourceAnalysis;

const recommended = ec2('t3a.medium', 'RIGHTSIZE', { recommendation: { instanceType: 't3a.small', vcpu: 2, memoryGb: 2 } });

describe('resolutionFor', () => {
  it('marks the change as APPLIED when the new type is the recommended one', () => {
    expect(resolutionFor(recommended, ec2('t3a.small', 'OPTIMIZED'))).toEqual({
      reason: 'APPLIED',
      finding: 'OPTIMIZED',
      detail: 'Changed from t3a.medium to t3a.small as recommended',
      change: {
        from: 't3a.medium',
        to: 't3a.small',
        recommended: 't3a.small',
        size: 'SMALLER',
        comparedToRecommended: 'SAME_SIZE',
        currentFit: null,
        monthlyCostFrom: 27.45,
        monthlyCostTo: 13.72,
      },
    });
  });

  it('tells apart a larger, a different smaller and a same-size change', () => {
    const larger = resolutionFor(recommended, ec2('t3a.large', 'OPTIMIZED'));
    expect(larger.reason).toBe('CHANGED_DIFFERENTLY');
    expect(larger.change).toMatchObject({ to: 't3a.large', size: 'LARGER', comparedToRecommended: 'LARGER', monthlyCostTo: 54.9 });
    expect(larger.detail).toBe('Changed from t3a.medium to t3a.large (larger), recommended was t3a.small (new type is larger than recommended)');

    expect(resolutionFor(recommended, ec2('c6a.large', 'OPTIMIZED')).change).toMatchObject({ size: 'SAME_SIZE', monthlyCostTo: 55.85 });
  });

  it('does not treat a type smaller than recommended as success and flags when usage no longer fits', () => {
    const micro = ec2('t3a.micro', 'OPTIMIZED', {
      options: [{ kind: 'CURRENT', instanceType: 't3a.micro', fit: 'DOES_NOT_FIT', projected: { memoryP95: 255 }, notes: [] }],
    });

    const resolution = resolutionFor(recommended, micro);

    expect(resolution.reason).toBe('CHANGED_DIFFERENTLY');
    expect(resolution.change).toMatchObject({ size: 'SMALLER', comparedToRecommended: 'SMALLER', currentFit: 'DOES_NOT_FIT' });
    expect(resolution.detail).toBe(
      'Changed from t3a.medium to t3a.micro (smaller), recommended was t3a.small (new type is smaller than recommended); current usage does not fit on t3a.micro',
    );
  });

  it('checks the type change before the current finding', () => {
    expect(resolutionFor(recommended, ec2('t3a.small', 'NOT_RUNNING')).reason).toBe('APPLIED');
  });

  it('explains a downsize that no longer fits with the projected usage', () => {
    const current = ec2('t3a.medium', 'OPTIMIZED', {
      options: [{ instanceType: 't3a.small', fit: 'DOES_NOT_FIT', projected: { memoryP95: 127.5, cpuP95: 6.67 }, notes: [] }],
    });

    expect(resolutionFor(recommended, current)).toEqual({
      reason: 'DOES_NOT_FIT',
      finding: 'OPTIMIZED',
      detail: 't3a.small does not fit current usage; projected memory P95 127.5%; projected CPU P95 6.67%',
    });
  });

  it('flags stopped instances, missing data and unexplained resolutions', () => {
    expect(resolutionFor(recommended, ec2('t3a.medium', 'NOT_RUNNING')).reason).toBe('NOT_RUNNING');
    expect(resolutionFor(recommended, ec2('t3a.medium', 'INSUFFICIENT_DATA')).reason).toBe('INSUFFICIENT_DATA');
    expect(resolutionFor(recommended, undefined)).toMatchObject({ reason: 'RESOURCE_REMOVED', finding: null });
    expect(resolutionFor(recommended, ec2('t3a.medium', 'OPTIMIZED'))).toEqual({
      reason: 'NO_LONGER_RECOMMENDED',
      finding: 'OPTIMIZED',
      detail: 'Latest analysis finding: OPTIMIZED',
    });
  });

  it('compares EBS volume types with the recommended target', () => {
    expect(resolutionFor(ebs('gp2', 'GP2_TO_GP3', 'gp3'), ebs('gp3', 'OPTIMIZED'))).toMatchObject({
      reason: 'APPLIED',
      change: { from: 'gp2', to: 'gp3', size: 'SAME_SIZE', monthlyCostFrom: 1.2, monthlyCostTo: 0.96 },
    });
    expect(resolutionFor(ebs('gp2', 'GP2_TO_GP3', 'gp3'), ebs('io1', 'OPTIMIZED')).reason).toBe('CHANGED_DIFFERENTLY');
    expect(resolutionFor(ebs('gp2', 'UNATTACHED'), ebs('gp2', 'GP2_TO_GP3')).reason).toBe('NO_LONGER_RECOMMENDED');
  });

  it('only reports a type change between analyses of the same kind', () => {
    expect(typeChanged(recommended, ec2('t3a.large', 'RIGHTSIZE'))).toBe(true);
    expect(typeChanged(recommended, ec2('t3a.medium', 'RIGHTSIZE'))).toBe(false);
    expect(typeChanged(undefined, recommended)).toBe(false);
  });
});

describe('resolutionOutcome', () => {
  const withSource = (a: ResourceAnalysis, costSource: string) => ({ ...a, current: { ...a.current, costSource } }) as ResourceAnalysis;
  const prev = withSource(recommended, 'ON_DEMAND_PRICE');
  const outcome = (current: ResourceAnalysis | undefined, type = RecommendationType.EC2_RIGHTSIZING, cost: number | null = 27.45) =>
    resolutionOutcome(type, prev, current, resolutionFor(prev, current), cost);

  it('implements an applied change with the price difference as realized savings', () => {
    expect(outcome(withSource(ec2('t3a.small', 'OPTIMIZED'), 'ON_DEMAND_PRICE'))).toEqual({
      implemented: true,
      realized: { amount: 13.73, source: 'ON_DEMAND_PRICE' },
    });
  });

  it('implements an applied change without realized savings when cost sources differ', () => {
    expect(outcome(withSource(ec2('t3a.small', 'OPTIMIZED'), 'COST_EXPLORER_RESOURCE'))).toEqual({ implemented: true, realized: null });
  });

  it('implements a cheaper different change only when current usage still fits', () => {
    const fits = (fit: string) =>
      withSource(ec2('t3a.micro', 'OPTIMIZED', { options: [{ kind: 'CURRENT', instanceType: 't3a.micro', fit, projected: {}, notes: [] }] }), 'ON_DEMAND_PRICE');
    expect(outcome(fits('FITS'))).toEqual({ implemented: true, realized: { amount: 20.59, source: 'ON_DEMAND_PRICE' } });
    expect(outcome(fits('TIGHT')).implemented).toBe(true);
    expect(outcome(fits('DOES_NOT_FIT'))).toEqual({ implemented: false, realized: null });
  });

  it('does not implement a more expensive change', () => {
    expect(outcome(withSource(ec2('t3a.large', 'OPTIMIZED'), 'ON_DEMAND_PRICE'))).toEqual({ implemented: false, realized: null });
  });

  it('implements removal recommendations when the resource is gone', () => {
    const ebsPrev = ebs('gp2', 'UNATTACHED');
    expect(resolutionOutcome(RecommendationType.EBS_UNUSED, ebsPrev, undefined, resolutionFor(ebsPrev, undefined), 1.2)).toEqual({
      implemented: true,
      realized: { amount: 1.2, source: 'RESOURCE_COST' },
    });
    expect(outcome(undefined, RecommendationType.EC2_RIGHTSIZING)).toEqual({ implemented: false, realized: null });
  });

  it('never records realized savings for an applied upsize', () => {
    const upPrev = withSource(ec2('t3a.micro', 'UPSIZE', { recommendation: { instanceType: 't3a.small', vcpu: 2, memoryGb: 2 } }), 'ON_DEMAND_PRICE');
    const upCur = withSource(ec2('t3a.small', 'OPTIMIZED'), 'ON_DEMAND_PRICE');
    expect(resolutionOutcome(RecommendationType.EC2_UPSIZE, upPrev, upCur, resolutionFor(upPrev, upCur), 6.86)).toEqual({ implemented: true, realized: null });
  });

  it('never records negative realized savings for an applied change', () => {
    const cheapPrev = withSource(ec2('t3a.small', 'RIGHTSIZE', { recommendation: { instanceType: 't3a.medium', vcpu: 2, memoryGb: 4 } }), 'ON_DEMAND_PRICE');
    const cur = withSource(ec2('t3a.medium', 'OPTIMIZED'), 'ON_DEMAND_PRICE');
    expect(resolutionOutcome(RecommendationType.EC2_RIGHTSIZING, cheapPrev, cur, resolutionFor(cheapPrev, cur), 13.72)).toEqual({ implemented: true, realized: null });
  });

  it('uses on-demand prices of both types when the billed cost source lags behind the change', () => {
    const current = (type: string, cost: number) => [{ kind: 'CURRENT', instanceType: type, fit: 'FITS', monthlyCost: cost, projected: {}, notes: [] }];
    const p = withSource(ec2('t3a.medium', 'RIGHTSIZE', { recommendation: { instanceType: 't3a.small', vcpu: 2, memoryGb: 2 }, options: current('t3a.medium', 27.45) }), 'COST_EXPLORER_RESOURCE');
    const c = withSource(ec2('t3a.small', 'OPTIMIZED', { options: current('t3a.small', 13.72) }), 'COST_EXPLORER_RESOURCE');
    expect(resolutionOutcome(RecommendationType.EC2_RIGHTSIZING, p, c, resolutionFor(p, c), 27.45)).toEqual({
      implemented: true,
      realized: { amount: 13.73, source: 'ON_DEMAND_PRICE' },
    });
  });

  it('counts only the volumes that are really gone when a stopped instance is removed', () => {
    const stoppedPrev = ec2('t3a.medium', 'STOPPED', {
      stoppedVolumes: [
        { volumeId: 'vol-root', monthlyCost: 0.96 },
        { volumeId: 'vol-data', monthlyCost: 1.2 },
      ],
    });
    const run = (present: string[]) =>
      resolutionOutcome(RecommendationType.EC2_STOPPED, stoppedPrev, undefined, resolutionFor(stoppedPrev, undefined), 2.16, (id) => present.includes(id));
    expect(run(['vol-data'])).toEqual({ implemented: true, realized: { amount: 0.96, source: 'RESOURCE_COST' } });
    expect(run([])).toEqual({ implemented: true, realized: { amount: 2.16, source: 'RESOURCE_COST' } });
    expect(resolutionOutcome(RecommendationType.EC2_STOPPED, ec2('t3a.medium', 'STOPPED'), undefined, resolutionFor(undefined, undefined), 2.16)).toEqual({
      implemented: true,
      realized: null,
    });
  });

  it('does not implement when the recommendation simply stopped applying', () => {
    expect(outcome(withSource(ec2('t3a.medium', 'OPTIMIZED'), 'ON_DEMAND_PRICE'))).toEqual({ implemented: false, realized: null });
  });
});
