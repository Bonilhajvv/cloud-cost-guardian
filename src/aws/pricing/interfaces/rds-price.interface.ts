export type RdsDeployment = 'Single-AZ' | 'Multi-AZ';

export interface RdsInstancePrice {
  monthly: number;
  vcpu: number | null;
}

export type RdsExtendedSupportYear = 'Year 1, Year 2' | 'Year 3';
