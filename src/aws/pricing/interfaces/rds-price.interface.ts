export type RdsDeployment = 'Single-AZ' | 'Multi-AZ';

export interface RdsInstancePrice {
  monthly: number;
  vcpu: number | null;
  memoryGb?: number | null;
}

export type RdsExtendedSupportYear = 'Year 1, Year 2' | 'Year 3';

export interface RdsStoragePrices {
  gbMonth: Record<string, number>;
  iopsMonth: Record<string, number>;
}
