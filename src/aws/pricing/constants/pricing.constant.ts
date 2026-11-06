export const PRICING_API_REGION = 'us-east-1';

export const HOURS_PER_MONTH = 730;

export const PRICE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const PRICING_OS_BY_PLATFORM: Record<string, string> = {
  'Linux/UNIX': 'Linux',
  Windows: 'Windows',
  'Red Hat Enterprise Linux': 'RHEL',
  'SUSE Linux': 'SUSE',
};

export const DEFAULT_PRICING_OS = 'Linux';
