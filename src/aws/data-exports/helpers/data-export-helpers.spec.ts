import { CUR_COLUMNS } from '../constants/data-exports.constant';
import { CurLine } from '../interfaces/data-export.interface';
import { amortizedCost, curLineReader, usageEntries } from './cur-line.helper';
import { parseCsv } from './parse-csv.helper';

async function rows(...chunks: string[]): Promise<string[][]> {
  const out: string[][] = [];
  async function* source() {
    yield* chunks;
  }
  for await (const row of parseCsv(source())) out.push(row);
  return out;
}

const line = (over: Partial<CurLine>): CurLine =>
  ({
    ...Object.fromEntries(CUR_COLUMNS.map((c) => [c, ''])),
    line_item_usage_start_date: '2026-11-03T00:00:00.000Z',
    line_item_resource_id: 'i-1',
    line_item_product_code: 'AmazonEC2',
    line_item_line_item_type: 'Usage',
    line_item_currency_code: 'USD',
    pricing_unit: 'Hrs',
    ...over,
  }) as CurLine;

describe('parseCsv', () => {
  it('handles quotes, commas, newlines and escaped quotes split across chunks', async () => {
    expect(await rows('a,"b,', '1","x"', '"y"\r\n', '"line\nbreak",,z\n', 'last,1,2')).toEqual([
      ['a', 'b,1', 'x"y'],
      ['line\nbreak', '', 'z'],
      ['last', '1', '2'],
    ]);
  });

  it('fails on a truncated quoted field', async () => {
    await expect(rows('a,"b')).rejects.toThrow('quoted');
  });
});

describe('CUR lines', () => {
  it('needs every column, in any order', () => {
    const header = [...CUR_COLUMNS].reverse();
    expect(curLineReader(header.slice(1))).toBeNull();
    expect(curLineReader(header)?.(header.map((h) => `v:${h}`)).pricing_unit).toBe('v:pricing_unit');
  });

  it.each([
    ['Usage', { line_item_unblended_cost: '2.4' }, 2.4],
    ['SavingsPlanCoveredUsage', { line_item_unblended_cost: '2.4', savings_plan_savings_plan_effective_cost: '1.7' }, 1.7],
    ['SavingsPlanRecurringFee', { savings_plan_total_commitment_to_date: '24', savings_plan_used_commitment: '20' }, 4],
    ['DiscountedUsage', { line_item_unblended_cost: '0', reservation_effective_cost: '1.2' }, 1.2],
    ['RIFee', { line_item_unblended_cost: '99', reservation_unused_recurring_fee: '3', reservation_unused_amortized_upfront_fee_for_billing_period: '2' }, 5],
    ['Fee', { line_item_unblended_cost: '500', reservation_reservation_a_r_n: 'arn:ri' }, null],
    ['Tax', { line_item_unblended_cost: '10' }, null],
    ['Credit', { line_item_unblended_cost: '-10' }, null],
    ['SavingsPlanNegation', { line_item_unblended_cost: '-2.4' }, null],
  ])('amortizes %s', (type, over, expected) => {
    expect(amortizedCost(line({ line_item_line_item_type: type, ...over }))).toBe(expected);
  });

  it('separates hourly usage from other charges of the same resource', () => {
    expect(usageEntries(line({ line_item_unblended_cost: '2.4', line_item_usage_amount: '24' }))[0]).toMatchObject({ day: '2026-11-03', cost: 2.4, hours: 24, hourlyCost: 2.4 });
    expect(usageEntries(line({ line_item_unblended_cost: '1', line_item_usage_amount: '10', pricing_unit: 'GB' }))[0]).toMatchObject({ cost: 1, hours: 0, hourlyCost: 0 });
  });

  it('books the net Savings Plan benefit on the account', () => {
    const covered = usageEntries(line({ line_item_line_item_type: 'SavingsPlanCoveredUsage', savings_plan_savings_plan_effective_cost: '1.7', pricing_public_on_demand_cost: '2.4', line_item_usage_amount: '24' }));
    expect(covered[1]).toMatchObject({ resourceId: 'ccg:savings-plans' });
    expect(covered[1].cost).toBeCloseTo(-0.7);
  });
});
