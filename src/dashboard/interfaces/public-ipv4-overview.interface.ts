export interface PublicIpv4Overview {
  addresses: number;
  monthlyCost: number | null;
  byOwner: Record<string, number>;
  unattached: number;
}
