import { KubernetesClustersService } from './kubernetes-clusters.service';

const PRD_VPC = 'vpc-084febaa87a506195';
const HML_VPC = 'vpc-07a91e7c9cadae9d9';

const candidate = (name: string, vpcId: string | null, cluster: string | null = null) => ({
  awsAccountId: 'acc-1',
  resourceId: `i-${name}`,
  name,
  metadata: {
    ec2: { vpcId },
    analysis: { kind: 'EC2', current: { monthlyCost: 10 }, kubernetes: { cluster, managedBy: 'SELF_MANAGED', role: 'WORKER', signals: [] } },
  },
});

function build(candidates: unknown[], connectedInstanceIds: string[] = []) {
  const inventory = { findKubernetesNodeCandidates: jest.fn().mockResolvedValue(candidates) };
  const nodes = { find: jest.fn().mockResolvedValue(connectedInstanceIds.map((instanceId) => ({ instanceId }))) };
  return new KubernetesClustersService({} as never, nodes as never, {} as never, {} as never, inventory as never, {} as never, {} as never);
}

describe('KubernetesClustersService.suggestions', () => {
  const tismoo = [
    ...['master-1', 'worker-1', 'worker-2', 'worker-3', 'worker-4', 'worker-5'].map((n) => candidate(`tismoo-ec2-kubernetes-${n}-prd`, PRD_VPC)),
    ...['master-1', 'worker-1', 'worker-2', 'worker-3'].map((n) => candidate(`tismoo-ec2-kubernetes-${n}-hml`, HML_VPC)),
  ];

  it('splits untagged clusters by VPC and derives the cluster name', async () => {
    const groups = await build(tismoo).suggestions('org-1');

    expect(groups.map((g) => [g.clusterName, g.vpcId, g.instanceIds.length])).toEqual([
      ['tismoo-ec2-kubernetes-prd', PRD_VPC, 6],
      ['tismoo-ec2-kubernetes-hml', HML_VPC, 4],
    ]);
    expect(groups[0].estimatedMonthlyCost).toBe(60);
  });

  it('keeps arbitrary names in the same VPC together without inventing a name', async () => {
    const groups = await build([candidate('joao', PRD_VPC), candidate('pedro', PRD_VPC)]).suggestions('org-1');

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ clusterName: null, vpcId: PRD_VPC, nodeNames: ['joao', 'pedro'] });
  });

  it('separates VPCs even when the derived names are equal', async () => {
    const groups = await build([candidate('app-worker-1', PRD_VPC), candidate('app-worker-1', HML_VPC)]).suggestions('org-1');

    expect(groups.map((g) => g.vpcId)).toEqual([PRD_VPC, HML_VPC]);
  });

  it('prefers the cluster tag over the VPC', async () => {
    const groups = await build([candidate('a', PRD_VPC, 'eks-dev'), candidate('b', PRD_VPC, 'eks-stg')]).suggestions('org-1');

    expect(groups.map((g) => g.clusterName)).toEqual(['eks-dev', 'eks-stg']);
  });

  it('skips instances already linked to a connected cluster', async () => {
    const groups = await build(tismoo, tismoo.slice(0, 6).map((c) => c.resourceId)).suggestions('org-1');

    expect(groups.map((g) => g.clusterName)).toEqual(['tismoo-ec2-kubernetes-hml']);
  });
});
