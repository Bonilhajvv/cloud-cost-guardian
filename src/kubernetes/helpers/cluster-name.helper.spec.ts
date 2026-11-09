import { deriveClusterName } from './cluster-name.helper';

describe('deriveClusterName', () => {
  it('removes role tokens and numbering and keeps the environment suffix', () => {
    expect(deriveClusterName(['tismoo-ec2-kubernetes-master-1-prd', 'tismoo-ec2-kubernetes-worker-5-prd'])).toBe('tismoo-ec2-kubernetes-prd');
  });

  it('handles control-plane and node naming', () => {
    expect(deriveClusterName(['app_control_plane_01', 'app-node-02'])).toBe('app');
  });

  it('returns null when names do not converge', () => {
    expect(deriveClusterName(['joao', 'pedro'])).toBeNull();
  });

  it('returns null for an empty list or names made only of role tokens', () => {
    expect(deriveClusterName([])).toBeNull();
    expect(deriveClusterName(['worker-1', 'worker-2'])).toBeNull();
  });
});
