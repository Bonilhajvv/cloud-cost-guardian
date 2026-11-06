import { hourlyToMonthly, parseOnDemandHourlyUsd } from './parse-price-list.helper';

const item = (usd: string, unit = 'Hrs') =>
  JSON.stringify({
    product: { attributes: { instanceType: 't3.medium' } },
    terms: {
      OnDemand: {
        'SKU.JRTCKXETXF': {
          priceDimensions: { 'SKU.JRTCKXETXF.6YS6EN2CT7': { unit, pricePerUnit: { USD: usd } } },
        },
      },
    },
  });

describe('parseOnDemandHourlyUsd', () => {
  it('extracts the hourly USD on-demand price', () => {
    expect(parseOnDemandHourlyUsd(item('0.0416000000'))).toBe(0.0416);
  });

  it('ignores zero, non-hourly and malformed entries', () => {
    expect(parseOnDemandHourlyUsd(item('0.0000000000'))).toBeNull();
    expect(parseOnDemandHourlyUsd(item('1.0', 'Quantity'))).toBeNull();
    expect(parseOnDemandHourlyUsd('not json')).toBeNull();
  });

  it('converts hourly to monthly (730h)', () => {
    expect(hourlyToMonthly(0.0416)).toBe(30.37);
  });
});
