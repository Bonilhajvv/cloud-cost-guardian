import { ipsToResolve, resolveNodeInstanceIds } from './node-instance.helper';

describe('resolveNodeInstanceIds', () => {
  const nodes = [
    { name: 'eks-node', providerId: 'aws:///us-east-1a/i-0aaa', internalIp: '10.0.1.1' },
    { name: 'ip-10-0-11-58', internalIp: '10.0.11.58' },
    { name: 'ip-10-0-11-80', internalIp: '10.0.11.80' },
    { name: 'no-ip' },
  ];

  it('prefers providerID and falls back to a unique private IP match', () => {
    const resolved = resolveNodeInstanceIds(nodes, [
      { instanceId: 'i-0bbb', privateIp: '10.0.11.58' },
      { instanceId: 'i-0ccc', privateIp: '10.0.11.80' },
      { instanceId: 'i-0ddd', privateIp: '10.0.11.80' },
    ]);

    expect(Object.fromEntries(resolved)).toEqual({
      'eks-node': 'i-0aaa',
      'ip-10-0-11-58': 'i-0bbb',
      'ip-10-0-11-80': null,
      'no-ip': null,
    });
  });

  it('only looks up IPs of nodes without providerID', () => {
    expect(ipsToResolve(nodes)).toEqual(['10.0.11.58', '10.0.11.80']);
  });
});
