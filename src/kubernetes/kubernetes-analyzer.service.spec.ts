import { Level, RecommendationType } from '../common/enums';
import { ContainerSpec, NodeGroupMember, NodePool, UsagePeak, WorkloadAnalyzerInput } from './interfaces/kubernetes-analysis.interface';
import { KubernetesAnalyzerService } from './kubernetes-analyzer.service';
import { EnvironmentInfo } from '../aws/core/interfaces/environment.interface';
import { effectiveWorkSchedule } from '../organizations/helpers/work-schedule.helper';
import { clusterEnvironment, namespaceEnvironment, nodeGroupEnvironment } from './helpers/kubernetes-environment.helper';

const NOW = new Date('2026-11-17T12:00:00Z');
const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const analyzer = new KubernetesAnalyzerService();
const PROD: EnvironmentInfo = { environment: 'PRODUCTION', source: 'NAME', detail: 'cluster name contains "prod"' };
const HML: EnvironmentInfo = { environment: 'NON_PRODUCTION', source: 'TAG', detail: 'node pool tag env=hml' };
const SCHEDULE = effectiveWorkSchedule(null);
const cluster = (name: string, environment: 'PRODUCTION' | 'NON_PRODUCTION' | null = null, namespaceEnvironments: Record<string, 'PRODUCTION' | 'NON_PRODUCTION'> = {}) => ({ name, environment, namespaceEnvironments });

const workload = (
  overrides: Partial<WorkloadAnalyzerInput['workload']> = {},
  peak: UsagePeak | null = { cpuCores: 0.3, memoryBytes: 0.8 * GIB, days: 14 },
  containerPeaks: Map<string, UsagePeak> = new Map(),
) =>
  analyzer.analyzeWorkload({
    clusterId: 'c-1',
    clusterName: 'prod',
    workload: { namespace: 'payments', kind: 'Deployment', name: 'api', podCount: 3, requestsCpu: 6, requestsMemoryBytes: 12 * GIB, limitsCpu: null, limitsMemoryBytes: null, hpa: null, containers: null, ...overrides },
    peak,
    containerPeaks,
    environment: PROD,
    currency: 'USD',
    now: NOW,
  });

const spec = (name: string, cpu: number | null, memory: number | null, memoryLimit: number | null = null): ContainerSpec => ({
  name,
  requests: { cpuCores: cpu, memoryBytes: memory },
  limits: { cpuCores: null, memoryBytes: memoryLimit },
});

const node = (name: string, peakCpu: number, peakMemoryGib: number, overrides: Partial<NodeGroupMember> = {}): NodeGroupMember => ({
  nodeName: name,
  instanceId: `i-${name}`,
  allocatableCpu: 3.92,
  allocatableMemoryBytes: 15 * GIB,
  peakRequests: { cpuCores: peakCpu, memoryBytes: peakMemoryGib * GIB, days: 14 },
  monthlyCost: 140.16,
  ...overrides,
});

const group = (nodes: NodeGroupMember[], pool: NodePool | null = { label: 'eks.amazonaws.com/nodegroup', value: 'ng-1' }, environment: EnvironmentInfo = PROD) =>
  analyzer.analyzeNodeGroup({ clusterId: 'c-1', clusterName: 'prod', pool, instanceType: 'm5.xlarge', nodes, environment, schedule: SCHEDULE, currency: 'USD', now: NOW });

describe('KubernetesAnalyzerService', () => {
  describe('workload requests', () => {
    it('lowers CPU and memory requests to the 14-day peak per pod plus 30%', () => {
      const { analysis, drafts: [draft] } = workload();
      expect(analysis.finding).toBe('OVER_PROVISIONED');
      expect(analysis.resourceId).toBe('k8s:c-1/payments/Deployment/api');
      expect(analysis.scope === 'WORKLOAD' && analysis.recommendedRequestsPerPod).toEqual({ cpuCores: 0.39, memoryBytes: 1072 * MIB });
      expect(analysis.scope === 'WORKLOAD' && analysis.current.basis).toBe('POD');
      expect(draft).toMatchObject({
        type: RecommendationType.K8S_WORKLOAD_RIGHTSIZING,
        service: 'kubernetes',
        resourceArn: null,
        title: 'Lower requests of Deployment payments/api: CPU 2000m to 390m, memory 4 GiB to 1.05 GiB per pod',
        estimatedMonthlySavings: null,
        risk: Level.MEDIUM,
        confidence: Level.HIGH,
        targetKey: 'CPU+MEMORY',
      });
      expect(draft?.description).toContain('Frees 4830m CPU and 8.86 GiB memory reserved on the nodes across 3 pod(s)');
      expect(draft?.description).toContain('OOMKilled');
    });

    it('needs at least 7 days of usage before recommending anything', () => {
      const { analysis, drafts } = workload({}, { cpuCores: 0.3, memoryBytes: 0.8 * GIB, days: 3 });
      expect(analysis.finding).toBe('INSUFFICIENT_DATA');
      expect(drafts).toEqual([]);
      expect(workload({}, null).analysis.finding).toBe('INSUFFICIENT_DATA');
    });

    it('keeps requests when the peak uses more than half of them', () => {
      const { analysis, drafts } = workload({}, { cpuCores: 1.2, memoryBytes: 2.5 * GIB, days: 14 });
      expect(analysis.finding).toBe('OPTIMIZED');
      expect(drafts).toEqual([]);
    });

    it('ignores reductions that free too little capacity to matter', () => {
      const { drafts } = workload({ podCount: 1, requestsCpu: 0.1, requestsMemoryBytes: 128 * MIB }, { cpuCores: 0.01, memoryBytes: 40 * MIB, days: 14 });
      expect(drafts).toEqual([]);
    });

    it('only touches CPU when memory is well sized, and warns about the HPA target', () => {
      const {
        drafts: [draft],
      } = workload({ hpa: { minReplicas: 2, maxReplicas: 10 } }, { cpuCores: 0.3, memoryBytes: 3 * GIB, days: 10 });
      expect(draft).toMatchObject({ targetKey: 'CPU', risk: Level.LOW, confidence: Level.MEDIUM });
      expect(draft?.description).toContain('HPA');
      expect(draft?.description).not.toContain('OOMKilled');
    });

    it('sets requests for a workload that has none, at the peak plus 30%', () => {
      const { analysis, drafts } = workload({ requestsCpu: 0, requestsMemoryBytes: 0 });
      expect(analysis.finding).toBe('UNDER_PROVISIONED');
      expect(drafts).toHaveLength(1);
      expect(drafts[0]).toMatchObject({
        type: RecommendationType.K8S_WORKLOAD_UNDERSIZED,
        title: 'Set requests of Deployment payments/api: CPU unset to 390m, memory unset to 1.05 GiB per pod',
        risk: Level.LOW,
        severity: Level.MEDIUM,
        estimatedMonthlySavings: null,
      });
      expect(drafts[0].description).toContain('BestEffort');
    });

    it('raises a CPU request the pods outgrew and warns that the HPA will remove replicas', () => {
      const { drafts } = workload({ requestsCpu: 0.6, hpa: { minReplicas: 2, maxReplicas: 10 } }, { cpuCores: 0.5, memoryBytes: 3 * GIB, days: 14 });
      expect(drafts).toHaveLength(1);
      expect(drafts[0]).toMatchObject({ type: RecommendationType.K8S_WORKLOAD_UNDERSIZED, title: 'Raise requests of Deployment payments/api: CPU 200m to 650m per pod', severity: Level.LOW, targetKey: 'CPU' });
      expect(drafts[0].description).toContain('slows down');
      expect(drafts[0].description).toContain('remove replicas');
    });

    it('sizes each container on its own and splits lowering from raising', () => {
      const peaks = new Map<string, UsagePeak>([
        ['app', { cpuCores: 0.3, memoryBytes: 0.8 * GIB, days: 14 }],
        ['sidecar', { cpuCores: 0.005, memoryBytes: 100 * MIB, days: 14 }],
      ]);
      const { analysis, drafts } = workload({ containers: [spec('app', 2, 4 * GIB), spec('sidecar', 0.01, 32 * MIB, 128 * MIB)] }, null, peaks);
      expect(analysis.scope === 'WORKLOAD' && analysis.current.basis).toBe('CONTAINER');
      expect(analysis.scope === 'WORKLOAD' && analysis.sizing.map((u) => [u.container, u.cpu, u.memory])).toEqual([
        ['app', 'DECREASE', 'DECREASE'],
        ['sidecar', null, 'INCREASE'],
      ]);
      expect(drafts.map((d) => [d.type, d.title, d.targetKey])).toEqual([
        [RecommendationType.K8S_WORKLOAD_RIGHTSIZING, 'Lower requests of Deployment payments/api: app CPU 2000m to 390m, memory 4 GiB to 1.05 GiB', 'app:CPU+MEMORY'],
        [RecommendationType.K8S_WORKLOAD_UNDERSIZED, 'Raise requests of Deployment payments/api: sidecar memory 32 MiB to 144 MiB', 'sidecar:MEMORY'],
      ]);
      expect(drafts[1].description).toContain('Container sidecar: the memory limit 128 MiB is below the new request');
      expect(drafts[1].description).toContain('Peak usage container sidecar (busiest pod) over 14 days');
    });

    it('falls back to the pod total while container history is shorter than 7 days', () => {
      const peaks = new Map<string, UsagePeak>([['app', { cpuCores: 0.3, memoryBytes: 0.8 * GIB, days: 3 }]]);
      const { analysis, drafts } = workload({ containers: [spec('app', 2, 4 * GIB)] }, undefined, peaks);
      expect(analysis.scope === 'WORKLOAD' && analysis.current.basis).toBe('POD');
      expect(drafts[0].title).toContain('per pod');
    });
  });

  describe('node consolidation', () => {
    it('removes nodes the peak requests do not need, keeping 85% fill and one spare node', () => {
      const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => node(n, 1, 3));
      const { analysis, drafts: [draft] } = group(nodes);
      expect(analysis.scope === 'NODE_GROUP' && analysis.recommendedNodes).toBe(3);
      expect(draft).toMatchObject({
        type: RecommendationType.K8S_NODE_CONSOLIDATION,
        title: 'Remove 3 of 6 nodes from ng-1 in cluster prod',
        currentMonthlyCost: 840.96,
        estimatedMonthlySavings: 420.48,
        recommendedMonthlyCost: 420.48,
        risk: Level.MEDIUM,
        targetKey: 'NODES=3',
      });
      expect(draft?.description).toContain('peak pod requests over 14 days were 6000m CPU (26% of allocatable) and 18 GiB memory (20% of allocatable)');
      expect(draft?.description).toContain('desired and minimum size');
    });

    it('sizes by the scarcer resource', () => {
      const nodes = ['a', 'b', 'c', 'd'].map((n) => node(n, 0.5, 11));
      expect(group(nodes).drafts).toEqual([]);
    });

    it('keeps the recommendation but reports unknown savings when a node has no price', () => {
      const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((n, i) => node(n, 1, 3, i === 0 ? { monthlyCost: null } : {}));
      const {
        drafts: [draft],
      } = group(nodes);
      expect(draft).toMatchObject({ estimatedMonthlySavings: null, currentMonthlyCost: null, severity: Level.LOW });
      expect(draft?.description).toContain('price of some nodes is unknown');
    });

    it('needs 7 days of request history and allocatable data', () => {
      expect(group(['a', 'b', 'c'].map((n) => node(n, 0.1, 0.5, { peakRequests: { cpuCores: 0.1, memoryBytes: GIB, days: 2 } }))).analysis.finding).toBe('INSUFFICIENT_DATA');
      expect(group(['a', 'b', 'c'].map((n) => node(n, 0.1, 0.5, { allocatableCpu: null }))).analysis.finding).toBe('INSUFFICIENT_DATA');
    });

    it('points Karpenter users to NodePool consolidation', () => {
      const nodes = ['a', 'b', 'c', 'd'].map((n) => node(n, 0.2, 1));
      const {
        drafts: [draft],
      } = group(nodes, { label: 'karpenter.sh/nodepool', value: 'default' });
      expect(draft?.description).toContain('consolidationPolicy: WhenEmptyOrUnderutilized');
    });
  });

  describe('environments and off-hours', () => {
    it('classifies namespaces before the cluster, and manual marks before names', () => {
      expect(namespaceEnvironment(cluster('prod-eks'), 'payments-hml')).toMatchObject({ environment: 'NON_PRODUCTION', source: 'NAME', detail: 'namespace name contains "hml"' });
      expect(namespaceEnvironment(cluster('prod-eks'), 'payments')).toMatchObject({ environment: 'PRODUCTION', detail: 'cluster name contains "prod"' });
      expect(namespaceEnvironment(cluster('prod-eks', null, { payments: 'NON_PRODUCTION' }), 'payments')).toMatchObject({ environment: 'NON_PRODUCTION', source: 'MANUAL' });
      expect(namespaceEnvironment(cluster('shared'), 'payments').environment).toBe('UNKNOWN');
      expect(clusterEnvironment(cluster('eks-hml', 'PRODUCTION'))).toMatchObject({ environment: 'PRODUCTION', source: 'MANUAL' });
    });

    it('classifies node groups by cluster mark, pool name, cluster name, then the nodes EC2', () => {
      const ec2Hml = { environment: 'NON_PRODUCTION' as const, source: 'TAG' as const, detail: 'tag env=hml' };
      expect(nodeGroupEnvironment(cluster('shared'), { label: 'eks.amazonaws.com/nodegroup', value: 'ng-hml' }, [])).toMatchObject({ environment: 'NON_PRODUCTION', detail: 'node pool name contains "hml"' });
      expect(nodeGroupEnvironment(cluster('shared'), null, [ec2Hml, ec2Hml])).toMatchObject({ environment: 'NON_PRODUCTION', detail: "every node's EC2 tag env=hml" });
      expect(nodeGroupEnvironment(cluster('shared'), null, [ec2Hml, null]).environment).toBe('UNKNOWN');
      expect(nodeGroupEnvironment(cluster('shared', 'PRODUCTION'), { label: 'x', value: 'ng-hml' }, [ec2Hml]).environment).toBe('PRODUCTION');
    });

    it('scales a non-production node group to zero off-hours, priced from its nodes', () => {
      const nodes = ['a', 'b'].map((n) => node(n, 3, 12));
      const { drafts, analysis } = group(nodes, { label: 'eks.amazonaws.com/nodegroup', value: 'ng-hml' }, HML);
      expect(analysis.environment).toEqual(HML);
      expect(drafts).toHaveLength(1);
      expect(drafts[0]).toMatchObject({
        type: RecommendationType.K8S_NODE_GROUP_SCHEDULE,
        title: 'Scale node group ng-hml in cluster prod to zero outside business hours (Mon-Fri 08:00-20:00)',
        currentMonthlyCost: 280.32,
        estimatedMonthlySavings: 180.21,
        confidence: Level.HIGH,
        targetKey: '12345-8-20',
      });
      expect(drafts[0].analysis.finding).toBe('OFF_HOURS');
      expect(group(nodes, null, PROD).drafts).toEqual([]);
    });

    it('adds the off-hours suggestion next to consolidation and even without request history', () => {
      const idle = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => node(n, 1, 3));
      expect(group(idle, null, HML).drafts.map((d) => d.type)).toEqual([RecommendationType.K8S_NODE_CONSOLIDATION, RecommendationType.K8S_NODE_GROUP_SCHEDULE]);
      const fresh = ['a', 'b'].map((n) => node(n, 1, 3, { peakRequests: { cpuCores: 1, memoryBytes: GIB, days: 1 } }));
      expect(group(fresh, null, HML).drafts.map((d) => d.type)).toEqual([RecommendationType.K8S_NODE_GROUP_SCHEDULE]);
    });

    it('scales a non-production namespace to zero off-hours in a shared cluster', () => {
      const run = (namespace: string, environment: EnvironmentInfo, cpu = 2) =>
        analyzer.analyzeNamespace({
          clusterId: 'c-1',
          clusterName: 'shared',
          namespace,
          workloads: [
            { kind: 'Deployment', podCount: 2, requestsCpu: cpu, requestsMemoryBytes: 4 * GIB },
            { kind: 'DaemonSet', podCount: 3, requestsCpu: 0.3, requestsMemoryBytes: GIB },
          ],
          environment,
          schedule: SCHEDULE,
          currency: 'USD',
          now: NOW,
        });
      const hml = { environment: 'NON_PRODUCTION' as const, source: 'NAME' as const, detail: 'namespace name contains "hml"' };
      const { drafts } = run('payments-hml', hml);
      expect(drafts[0]).toMatchObject({ type: RecommendationType.K8S_NAMESPACE_SCHEDULE, resourceId: 'k8s:c-1/namespace/payments-hml', estimatedMonthlySavings: null, confidence: Level.MEDIUM });
      expect(drafts[0].description).toContain('reserve 2000m CPU and 4 GiB memory');
      expect(drafts[0].description).toContain('kube-downscaler');
      expect(run('payments', PROD).drafts).toEqual([]);
      expect(run('kube-system', hml).drafts).toEqual([]);
      expect(run('tiny-hml', hml, 0.05).drafts).toHaveLength(1);
    });
  });
});
