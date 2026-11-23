import { canonicalResourceType, normalizeResource } from './normalize-resource.helper';

describe('normalizeResource', () => {
  it('keeps one resource type for every kind of load balancer', () => {
    for (const kind of ['app', 'net', 'gwy']) expect(canonicalResourceType(`elasticloadbalancing:loadbalancer/${kind}`)).toBe('elasticloadbalancing:loadbalancer');
    expect(canonicalResourceType('elasticloadbalancing:targetgroup')).toBe('elasticloadbalancing:targetgroup');
    expect(normalizeResource({ Arn: 'arn:aws:elasticloadbalancing:us-east-1:111122223333:loadbalancer/app/api/abc', ResourceType: 'elasticloadbalancing:loadbalancer/app' })).toMatchObject({
      resourceId: 'abc',
      resourceType: 'elasticloadbalancing:loadbalancer',
    });
  });
});
