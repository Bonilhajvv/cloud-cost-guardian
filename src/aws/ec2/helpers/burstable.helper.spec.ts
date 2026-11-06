import { burstableBaselinePercent, isBurstable } from './burstable.helper';

describe('burstable helper', () => {
  it.each([
    ['t3.small', true],
    ['t4g.medium', true],
    ['t3a.large', true],
    ['m6i.large', false],
    ['c5.xlarge', false],
  ])('isBurstable(%s) = %s', (type, expected) => {
    expect(isBurstable(type)).toBe(expected);
  });

  it.each([
    ['t3.nano', 5],
    ['t3.micro', 10],
    ['t3.small', 20],
    ['t3.medium', 20],
    ['t3.large', 30],
    ['t2.xlarge', 22.5],
    ['m6i.large', null],
  ])('baseline(%s) = %s', (type, expected) => {
    expect(burstableBaselinePercent(type)).toBe(expected);
  });
});
