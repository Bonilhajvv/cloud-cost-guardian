export type PublicIpv4Owner = 'EC2' | 'LOAD_BALANCER' | 'RDS' | 'NAT_GATEWAY' | 'OTHER' | 'UNATTACHED';

export interface PublicIpv4 {
  ip: string;
  region: string;
  elastic: boolean;
  owner: PublicIpv4Owner;
  ownerId: string | null;
  networkInterfaceId: string | null;
}

export interface ElasticIp {
  allocationId: string;
  publicIp: string;
  region: string;
  associationId: string | null;
  instanceId: string | null;
  networkInterfaceId: string | null;
  name: string | null;
  tags: Record<string, string>;
}

export interface NatGateway {
  natGatewayId: string;
  region: string;
  vpcId: string | null;
  subnetId: string | null;
  connectivity: string;
  name: string | null;
  tags: Record<string, string>;
  createTime: string | null;
  publicIps: string[];
}

export interface LoadBalancer {
  arn: string;
  id: string;
  name: string;
  region: string;
  type: string;
  scheme: string | null;
  vpcId: string | null;
  createdAt: string | null;
  metricDimension: string;
}

export interface NetworkUsage {
  periodDays: number;
  total: number | null;
  datapoints: number;
}

export interface NetworkPrices {
  publicIpv4Hourly: number | null;
  natGatewayHourly: number | null;
  natGatewayPerGb: number | null;
  loadBalancerHourly: Record<string, number>;
}

export type NetworkResource =
  | { kind: 'EIP'; eip: ElasticIp }
  | { kind: 'NAT'; nat: NatGateway; usage: NetworkUsage | null }
  | { kind: 'LB'; lb: LoadBalancer; usage: NetworkUsage | null; publicIpv4: number }
  | { kind: 'VPC'; vpcId: string; region: string; natGatewayIds: string[]; natProcessedGb: number | null; gatewayEndpoints: string[] };

export interface NetworkSnapshot {
  fetchedAt: string;
  publicIpv4: PublicIpv4[];
  publicIpv4Hourly: number | null;
}
