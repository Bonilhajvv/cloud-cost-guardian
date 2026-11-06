export interface OnDemandPriceQuery {
  region: string;
  instanceType: string;
  operatingSystem: string;
}

export interface PriceFilter {
  Type: 'TERM_MATCH';
  Field: string;
  Value: string;
}

export interface CachedPrice {
  monthly: number | null;
  expiresAt: number;
}
