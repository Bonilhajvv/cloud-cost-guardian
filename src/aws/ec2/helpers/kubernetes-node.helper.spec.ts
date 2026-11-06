import { detectKubernetesNode } from './kubernetes-node.helper';

describe('detectKubernetesNode', () => {
  it('returns null for regular instances', () => {
    expect(detectKubernetesNode({ name: 'production-api', tags: { Name: 'production-api' } })).toBeNull();
    expect(detectKubernetesNode({ name: 'weekly-report', tags: {} })).toBeNull();
  });

  it('detects EKS managed nodes as workers with cluster name', () => {
    expect(detectKubernetesNode({ name: 'ng-1', tags: { 'eks:cluster-name': 'prod', 'eks:nodegroup-name': 'ng-1' } })).toMatchObject({
      role: 'WORKER',
      cluster: 'prod',
      managedBy: 'EKS',
    });
  });

  it('detects self-managed control plane by tag or name', () => {
    expect(detectKubernetesNode({ name: 'cp', tags: { 'kubernetes.io/cluster/lab': 'owned', 'k8s.io/role/master': '1' } })).toMatchObject({
      role: 'CONTROL_PLANE',
      cluster: 'lab',
      managedBy: 'SELF_MANAGED',
    });
    expect(detectKubernetesNode({ name: 'abrappe-ec2-kubernetes-master-1-prod', tags: {} })).toMatchObject({ role: 'CONTROL_PLANE' });
  });

  it('detects self-managed workers by name', () => {
    expect(detectKubernetesNode({ name: 'abrappe-ec2-kubernetes-worker-2-prod', tags: {} })).toMatchObject({ role: 'WORKER' });
  });
});
