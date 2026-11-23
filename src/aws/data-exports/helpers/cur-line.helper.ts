import {
  CUR_COLUMNS,
  HOUR_UNITS,
  HOURLY_LINE_TYPES,
  IGNORED_LINE_TYPES,
  RESERVED_INSTANCES_USAGE_KEY,
  SAVINGS_PLANS_USAGE_KEY,
} from '../constants/data-exports.constant';
import { CurLine, UsageEntry } from '../interfaces/data-export.interface';

function num(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function curLineReader(header: readonly string[]): ((row: readonly string[]) => CurLine) | null {
  const index = new Map(header.map((name, i) => [name, i]));
  if (CUR_COLUMNS.some((c) => !index.has(c))) return null;
  return (row) => Object.fromEntries(CUR_COLUMNS.map((c) => [c, row[index.get(c) as number] ?? ''])) as CurLine;
}

export function amortizedCost(line: CurLine): number | null {
  const type = line.line_item_line_item_type;
  if (IGNORED_LINE_TYPES.includes(type)) return null;
  switch (type) {
    case 'SavingsPlanCoveredUsage':
      return num(line.savings_plan_savings_plan_effective_cost);
    case 'SavingsPlanRecurringFee':
      return num(line.savings_plan_total_commitment_to_date) - num(line.savings_plan_used_commitment);
    case 'DiscountedUsage':
      return num(line.reservation_effective_cost);
    case 'RIFee':
      return num(line.reservation_unused_amortized_upfront_fee_for_billing_period) + num(line.reservation_unused_recurring_fee);
    case 'Fee':
      return line.reservation_reservation_a_r_n ? null : num(line.line_item_unblended_cost);
    default:
      return num(line.line_item_unblended_cost);
  }
}

export function usageEntries(line: CurLine): UsageEntry[] {
  const cost = amortizedCost(line);
  const day = line.line_item_usage_start_date.slice(0, 10);
  if (cost === null || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
  const type = line.line_item_line_item_type;
  const hourly = HOURLY_LINE_TYPES.includes(type) && HOUR_UNITS.includes(line.pricing_unit);
  const hours = hourly ? num(line.line_item_usage_amount) : 0;
  const base = { day, currency: line.line_item_currency_code || 'USD' };
  const entries: UsageEntry[] = [];
  if (cost !== 0 || hours !== 0) {
    entries.push({
      ...base,
      resourceId: line.line_item_resource_id.slice(0, 512),
      service: line.line_item_product_code.slice(0, 64),
      cost,
      hours,
      hourlyCost: hourly ? cost : 0,
    });
  }
  const commitment = (resourceId: string, amount: number) => entries.push({ ...base, resourceId, service: 'commitments', cost: amount, hours: 0, hourlyCost: 0 });
  if (type === 'SavingsPlanCoveredUsage') commitment(SAVINGS_PLANS_USAGE_KEY, cost - num(line.pricing_public_on_demand_cost));
  if (type === 'SavingsPlanRecurringFee') commitment(SAVINGS_PLANS_USAGE_KEY, cost);
  if (type === 'DiscountedUsage') commitment(RESERVED_INSTANCES_USAGE_KEY, cost - num(line.pricing_public_on_demand_cost));
  if (type === 'RIFee') commitment(RESERVED_INSTANCES_USAGE_KEY, cost);
  return entries;
}
