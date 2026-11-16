import { NetworkInterface } from '@aws-sdk/client-ec2';
import { normalizeLoadBalancer, normalizeNatGateway, publicIpv4Of } from './normalize-network.helper';

const eni = (description: string, extra: Partial<NetworkInterface>, ip: string, allocationId?: string): NetworkInterface => ({
  Description: description,
  NetworkInterfaceId: `eni-${ip}`,
  PrivateIpAddresses: [{ Association: { PublicIp: ip, AllocationId: allocationId } }],
  ...extra,
});

describe('network normalizers', () => {
  it('classifies who holds each public IPv4 (shapes from a real account)', () => {
    const ips = publicIpv4Of(
      [
        eni('Primary network interface', { Attachment: { InstanceId: 'i-1' } }, '198.51.100.30'),
        eni('ELB app/example-alb/0123456789abcdef', {}, '198.51.100.10', 'eipalloc-1'),
        eni('RDSNetworkInterface', {}, '198.51.100.20', 'eipalloc-2'),
        eni('Interface for NAT Gateway nat-0abc', { InterfaceType: 'natGateway' }, '3.3.3.3'),
        eni('', {}, '4.4.4.4'),
      ],
      [{ allocationId: 'eipalloc-9', publicIp: '9.9.9.9', region: 'us-east-1', associationId: null, instanceId: null, networkInterfaceId: null, name: null, tags: {} }],
      'us-east-1',
    );

    expect(ips.map((i) => [i.ip, i.owner, i.ownerId, i.elastic])).toEqual([
      ['198.51.100.30', 'EC2', 'i-1', false],
      ['198.51.100.10', 'LOAD_BALANCER', 'app/example-alb/0123456789abcdef', true],
      ['198.51.100.20', 'RDS', null, true],
      ['3.3.3.3', 'NAT_GATEWAY', 'nat-0abc', false],
      ['4.4.4.4', 'OTHER', null, false],
      ['9.9.9.9', 'UNATTACHED', 'eipalloc-9', true],
    ]);
  });

  it('keeps only active load balancers and available NAT Gateways', () => {
    const lb = normalizeLoadBalancer(
      { LoadBalancerArn: 'arn:aws:elasticloadbalancing:us-east-1:1:loadbalancer/app/api/0123456789abcdef', LoadBalancerName: 'api', Type: 'application', State: { Code: 'active' } },
      'us-east-1',
    );
    expect(lb).toMatchObject({ id: '0123456789abcdef', metricDimension: 'app/api/0123456789abcdef' });
    expect(normalizeLoadBalancer({ LoadBalancerArn: 'arn:x:loadbalancer/app/a/b', LoadBalancerName: 'a', Type: 'application', State: { Code: 'provisioning' } }, 'us-east-1')).toBeNull();
    expect(normalizeNatGateway({ NatGatewayId: 'nat-1', State: 'deleted' }, 'us-east-1')).toBeNull();
  });
});
