import { Address, NatGateway as Ec2NatGateway, NetworkInterface, Tag } from '@aws-sdk/client-ec2';
import { LoadBalancer as ElbLoadBalancer } from '@aws-sdk/client-elastic-load-balancing-v2';
import { ElasticIp, LoadBalancer, NatGateway, PublicIpv4, PublicIpv4Owner } from '../interfaces/network.interface';

function tagsOf(tags: Tag[] | undefined): Record<string, string> {
  return Object.fromEntries((tags ?? []).filter((t) => t.Key).map((t) => [t.Key as string, t.Value ?? '']));
}

export function normalizeElasticIp(a: Address, region: string): ElasticIp | null {
  if (!a.AllocationId || !a.PublicIp) return null;
  const tags = tagsOf(a.Tags);
  return {
    allocationId: a.AllocationId,
    publicIp: a.PublicIp,
    region,
    associationId: a.AssociationId ?? null,
    instanceId: a.InstanceId ?? null,
    networkInterfaceId: a.NetworkInterfaceId ?? null,
    name: tags.Name ?? null,
    tags,
  };
}

export function normalizeNatGateway(n: Ec2NatGateway, region: string): NatGateway | null {
  if (!n.NatGatewayId || n.State !== 'available') return null;
  const tags = tagsOf(n.Tags);
  return {
    natGatewayId: n.NatGatewayId,
    region,
    vpcId: n.VpcId ?? null,
    subnetId: n.SubnetId ?? null,
    connectivity: n.ConnectivityType ?? 'public',
    name: tags.Name ?? null,
    tags,
    createTime: n.CreateTime?.toISOString() ?? null,
    publicIps: (n.NatGatewayAddresses ?? []).map((a) => a.PublicIp).filter((ip): ip is string => !!ip),
  };
}

export function normalizeLoadBalancer(lb: ElbLoadBalancer, region: string): LoadBalancer | null {
  if (!lb.LoadBalancerArn || !lb.LoadBalancerName || !lb.Type || lb.State?.Code !== 'active') return null;
  const dimension = lb.LoadBalancerArn.split(':loadbalancer/')[1];
  if (!dimension) return null;
  return {
    arn: lb.LoadBalancerArn,
    id: dimension.split('/').pop() as string,
    name: lb.LoadBalancerName,
    region,
    type: lb.Type,
    scheme: lb.Scheme ?? null,
    vpcId: lb.VpcId ?? null,
    createdAt: lb.CreatedTime?.toISOString() ?? null,
    metricDimension: dimension,
  };
}

function ownerOf(eni: NetworkInterface): { owner: PublicIpv4Owner; ownerId: string | null } {
  const description = eni.Description ?? '';
  if (eni.Attachment?.InstanceId) return { owner: 'EC2', ownerId: eni.Attachment.InstanceId };
  if (eni.InterfaceType === 'natGateway') return { owner: 'NAT_GATEWAY', ownerId: description.split(' ').pop() ?? null };
  if (description.startsWith('ELB ')) return { owner: 'LOAD_BALANCER', ownerId: description.slice(4) };
  if (description === 'RDSNetworkInterface') return { owner: 'RDS', ownerId: null };
  return { owner: 'OTHER', ownerId: description || null };
}

export function publicIpv4Of(enis: NetworkInterface[], unattached: ElasticIp[], region: string): PublicIpv4[] {
  const attached = enis.flatMap((eni) => {
    const { owner, ownerId } = ownerOf(eni);
    return (eni.PrivateIpAddresses ?? [])
      .map((p) => p.Association)
      .filter((a): a is NonNullable<typeof a> => !!a?.PublicIp)
      .map((a) => ({ ip: a.PublicIp as string, region, elastic: !!a.AllocationId, owner, ownerId, networkInterfaceId: eni.NetworkInterfaceId ?? null }));
  });
  const free = unattached.map((e) => ({ ip: e.publicIp, region, elastic: true, owner: 'UNATTACHED' as const, ownerId: e.allocationId, networkInterfaceId: null }));
  return [...attached, ...free];
}
