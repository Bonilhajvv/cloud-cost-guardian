export const DATA_EXPORT_REGION = 'us-east-1';

export const DATA_EXPORT_NAME = 'ccg-cur';

export const DATA_EXPORT_PREFIX = 'ccg';

export const DATA_EXPORT_BUCKET_PREFIX = 'ccg-cur';

export const dataExportBucket = (awsAccountId: string): string => `${DATA_EXPORT_BUCKET_PREFIX}-${awsAccountId}`;

export const CUR_COLUMNS = [
  'line_item_usage_start_date',
  'line_item_usage_account_id',
  'line_item_resource_id',
  'line_item_product_code',
  'line_item_line_item_type',
  'line_item_unblended_cost',
  'line_item_currency_code',
  'line_item_usage_amount',
  'pricing_unit',
  'pricing_public_on_demand_cost',
  'savings_plan_savings_plan_effective_cost',
  'savings_plan_total_commitment_to_date',
  'savings_plan_used_commitment',
  'reservation_effective_cost',
  'reservation_reservation_a_r_n',
  'reservation_unused_amortized_upfront_fee_for_billing_period',
  'reservation_unused_recurring_fee',
] as const;

export const CUR_QUERY = `SELECT ${CUR_COLUMNS.join(', ')} FROM COST_AND_USAGE_REPORT`;

export const CUR_TABLE_CONFIGURATION = {
  TIME_GRANULARITY: 'DAILY',
  INCLUDE_RESOURCES: 'TRUE',
  INCLUDE_MANUAL_DISCOUNT_COMPATIBILITY: 'FALSE',
  INCLUDE_SPLIT_COST_ALLOCATION_DATA: 'FALSE',
} as const;

export const IGNORED_LINE_TYPES: readonly string[] = ['Tax', 'Credit', 'Refund', 'SavingsPlanNegation', 'SavingsPlanUpfrontFee'];

export const HOUR_UNITS: readonly string[] = ['Hrs', 'Hours', 'hours'];

export const HOURLY_LINE_TYPES: readonly string[] = ['Usage', 'DiscountedUsage', 'SavingsPlanCoveredUsage'];

export const SAVINGS_PLANS_USAGE_KEY = 'ccg:savings-plans';

export const RESERVED_INSTANCES_USAGE_KEY = 'ccg:reserved-instances';

export const MAX_CSV_FIELD_LENGTH = 1_000_000;

export const BILLING_PERIOD_PATTERN = /\/BILLING_PERIOD=(\d{4}-\d{2})\//;
