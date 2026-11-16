import { publicIpv4Overview } from './public-ipv4-overview.helper';

describe('publicIpv4Overview', () => {
  it('counts addresses by owner with their monthly cost', () => {
    const ip = (owner: 'EC2' | 'RDS' | 'UNATTACHED') => ({ ip: '1.1.1.1', region: 'us-east-1', elastic: false, owner, ownerId: null, networkInterfaceId: null });
    expect(publicIpv4Overview([{ fetchedAt: '', publicIpv4: [ip('EC2'), ip('EC2'), ip('RDS'), ip('UNATTACHED')], publicIpv4Hourly: 0.005 }, null])).toEqual({
      addresses: 4,
      monthlyCost: 14.6,
      byOwner: { EC2: 2, RDS: 1, UNATTACHED: 1 },
      unattached: 1,
    });
    expect(publicIpv4Overview([null]).monthlyCost).toBeNull();
    expect(publicIpv4Overview([{ fetchedAt: '', publicIpv4: [ip('EC2')], publicIpv4Hourly: null }]).monthlyCost).toBeNull();
  });
});
