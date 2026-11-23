import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AgentReportDto } from '../dto/agent-report.dto';
import { KubePod, KubeSnapshot } from '../interfaces/kube-objects.interface';
import { aggregateSnapshot } from './aggregate-snapshot.helper';
import { renderEksRbac } from './manifest.helper';
import { parseQuantity } from './quantity.helper';

const MIB = 1024 ** 2;

function pod(name: string, phase: string, memory: string): KubePod {
  return {
    metadata: { name, namespace: 'prod', ownerReferences: [{ kind: 'ReplicaSet', name: 'api-7d9f', controller: true }] },
    spec: {
      nodeName: 'worker-1',
      containers: [{ name: 'app', resources: { requests: { cpu: '250m', memory }, limits: { memory: '1Gi' } } }],
      initContainers: [{ name: 'init', resources: { requests: { cpu: '100m', memory: '64Mi' } } }],
    },
    status: { phase },
  };
}

const snapshot: KubeSnapshot = {
  nodes: [
    {
      metadata: { name: 'worker-1', labels: { 'node.kubernetes.io/instance-type': 't3.medium', team: 'secret' } },
      spec: { providerID: 'aws:///us-east-1a/i-0ea49e6ecda54b39d' },
      status: { capacity: { cpu: '2', memory: '3977560Ki' }, allocatable: { cpu: '1930m', memory: '3460Mi' }, addresses: [{ type: 'Hostname', address: 'worker-1' }, { type: 'InternalIP', address: '10.0.11.58' }] },
    },
    { metadata: { name: 'master-1', labels: { 'node-role.kubernetes.io/control-plane': '' } } },
  ],
  pods: [pod('api-1', 'Running', '512Mi'), pod('api-2', 'Running', '512Mi'), pod('old', 'Succeeded', '4Gi')],
  replicaSets: [{ metadata: { name: 'api-7d9f', namespace: 'prod', ownerReferences: [{ kind: 'Deployment', name: 'api', controller: true }] } }],
  deployments: [{ metadata: { name: 'api', namespace: 'prod' }, spec: { replicas: 2 } }],
  statefulSets: [],
  daemonSets: [],
  hpas: [{ metadata: { name: 'api', namespace: 'prod' }, spec: { scaleTargetRef: { kind: 'Deployment', name: 'api' }, minReplicas: 2, maxReplicas: 6 } }],
  nodeMetrics: [{ metadata: { name: 'worker-1' }, usage: { cpu: '123456789n', memory: '1500Mi' } }],
  podMetrics: [{ metadata: { name: 'api-1', namespace: 'prod' }, containers: [{ name: 'app', usage: { cpu: '50m', memory: '300Mi' } }] }],
};

describe('aggregateSnapshot', () => {
  const result = aggregateSnapshot(snapshot);

  it('reports the same totals as the agent', () => {
    const [worker, master] = result.nodes;
    expect(worker).toMatchObject({ role: 'worker', internalIp: '10.0.11.58', instanceType: 't3.medium', podCount: 2, requests: { cpuCores: 0.5, memoryBytes: 1024 * MIB }, usage: { memoryBytes: 1500 * MIB } });
    expect(worker.labels).toEqual({ 'node.kubernetes.io/instance-type': 't3.medium' });
    expect(master).toMatchObject({ role: 'control-plane', podCount: 0 });
    expect(result.workloads).toHaveLength(1);
    expect(result.workloads[0]).toMatchObject({ kind: 'Deployment', name: 'api', podCount: 2, desiredReplicas: 2, usage: { memoryBytes: 300 * MIB }, hpa: { minReplicas: 2, maxReplicas: 6 } });
    expect(result.workloads[0].containers).toMatchObject([{ name: 'app', requests: { cpuCores: 0.25, memoryBytes: 512 * MIB }, usage: { cpuCores: 0.05, memoryBytes: 300 * MIB } }]);
  });

  it('passes the validation of the agent report', () => {
    const report = plainToInstance(AgentReportDto, { agentVersion: 'eks-api', installMethod: 'unknown', kubernetesVersion: 'v1.34.0', metricsServerAvailable: true, collectedAt: new Date().toISOString(), ...result });
    expect(validateSync(report, { whitelist: true })).toEqual([]);
  });

  it('keeps the usage unknown without metrics-server', () => {
    const { nodes, workloads } = aggregateSnapshot({ ...snapshot, nodeMetrics: null, podMetrics: null });
    expect(nodes[0].usage).toBeUndefined();
    expect(workloads[0].usage).toBeUndefined();
  });
});

describe('parseQuantity', () => {
  it.each([
    ['250m', 0.25],
    ['1.5', 1.5],
    ['512Mi', 512 * MIB],
    ['1e3', 1000],
    ['2E', 2e18],
    ['123n', 1.23e-7],
    ['', 0],
    ['abc', 0],
  ])('%s', (raw, expected) => expect(parseQuantity(raw)).toBeCloseTo(expected));
});

describe('renderEksRbac', () => {
  it('grants only reads, without secrets, configmaps or kubelet access', () => {
    const yaml = renderEksRbac();
    expect(yaml).toContain('name: ccg-readonly');
    expect(yaml).not.toMatch(/secrets|configmaps|nodes\/|proxy|create|update|patch|delete/);
  });
});
