import { ConfigService } from '@nestjs/config';
import { PricingService } from './pricing.service';

const item = (unit: string, usd: string) =>
  JSON.stringify({ terms: { OnDemand: { t: { priceDimensions: { d: { unit, pricePerUnit: { USD: usd } } } } } } });

describe('PricingService.getEbsPerformancePrices', () => {
  it('reads IOPS per month and converts gp3 throughput from GiBps-mo to MB/s-mo', async () => {
    const service = new PricingService({ get: () => 3 } as unknown as ConfigService<never, true>);
    const send = jest.fn(async (command: { input: { Filters: { Field: string; Value: string }[] } }) => {
      const family = command.input.Filters.find((f) => f.Field === 'productFamily')?.Value;
      const type = command.input.Filters.find((f) => f.Field === 'volumeApiName')?.Value;
      if (family === 'Provisioned Throughput') return { PriceList: [item('GiBps-mo', '40.96')] };
      return { PriceList: [item('IOPS-Mo', type === 'gp3' ? '0.005' : '0.065')] };
    });
    Object.assign(service, { client: { send } });

    const prices = await service.getEbsPerformancePrices('us-east-1', ['gp3', 'io2', 'io2']);

    expect(prices).toEqual({ iopsMonth: { gp3: 0.005, io2: 0.065 }, throughputMBpsMonth: { gp3: 0.04 } });
    expect(send).toHaveBeenCalledTimes(3);
    const io2Filters = send.mock.calls[2][0].input.Filters;
    expect(io2Filters).toContainEqual({ Type: 'TERM_MATCH', Field: 'group', Value: 'EBS IOPS' });
  });
});

describe('PricingService RDS prices', () => {
  const product = (usd: string, unit: string, vcpu?: string) =>
    JSON.stringify({ product: { attributes: vcpu ? { vcpu } : {} }, terms: { OnDemand: { t: { priceDimensions: { d: { unit, pricePerUnit: { USD: usd } } } } } } });

  it('returns the monthly price and vCPU of RDS classes and skips unknown engines', async () => {
    const service = new PricingService({ get: () => 3 } as unknown as ConfigService<never, true>);
    const send = jest.fn(async (command: { input: { ServiceCode: string; Filters: { Field: string; Value: string }[] } }) => {
      const family = command.input.Filters.find((f) => f.Field === 'productFamily')?.Value;
      return { PriceList: family === 'Database Instance' ? [product('0.072', 'Hrs', '2')] : [product('0.1', 'vCPU-hour')] };
    });
    Object.assign(service, { client: { send } });

    expect(await service.getRdsInstancePrices('us-east-1', 'postgres', 'Single-AZ', ['db.t3.medium'])).toEqual({ 'db.t3.medium': { monthly: 52.56, vcpu: 2 } });
    expect(await service.getRdsExtendedSupportHourlyPerVcpu('us-east-1', 'postgres', '13', 'Year 1, Year 2')).toBe(0.1);
    expect(await service.getRdsInstancePrices('us-east-1', 'oracle-ee', 'Single-AZ', ['db.m6i.large'])).toEqual({});
    expect(send.mock.calls.every(([c]) => c.input.ServiceCode === 'AmazonRDS')).toBe(true);
    expect(send.mock.calls[0][0].input.Filters).toContainEqual({ Type: 'TERM_MATCH', Field: 'deploymentOption', Value: 'Single-AZ' });
  });
});
