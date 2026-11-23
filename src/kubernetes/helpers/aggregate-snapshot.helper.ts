import { FORWARDED_LABEL_PREFIXES } from '../constants/eks-connection.constant';
import { ReportContainerDto, ReportNodeDto, ReportWorkloadDto } from '../dto/agent-report.dto';
import { KubeContainer, KubeMeta, KubePod, KubeQuantities, KubeSnapshot } from '../interfaces/kube-objects.interface';
import { parseQuantity } from './quantity.helper';

interface Amount {
  cpuCores: number;
  memoryBytes: number;
}

interface ContainerTotals {
  requests: Amount;
  limits: Amount;
  usage?: Amount;
}

interface WorkloadTotals extends ContainerTotals {
  id: [string, string, string];
  podCount: number;
  containers: Map<string, ContainerTotals>;
}

const amountOf = (q?: KubeQuantities): Amount => ({ cpuCores: parseQuantity(q?.cpu), memoryBytes: parseQuantity(q?.memory) });

const add = (a: Amount, b: Amount): Amount => ({ cpuCores: a.cpuCores + b.cpuCores, memoryBytes: a.memoryBytes + b.memoryBytes });

const peak = (a: Amount, b: Amount): Amount => ({ cpuCores: Math.max(a.cpuCores, b.cpuCores), memoryBytes: Math.max(a.memoryBytes, b.memoryBytes) });

const ZERO: Amount = { cpuCores: 0, memoryBytes: 0 };

const podKey = (meta: KubeMeta): string => `${meta.namespace ?? ''}/${meta.name}`;

const workloadKey = (namespace: string, kind: string, name: string): string => JSON.stringify([namespace, kind, name]);

const controllerOf = (meta: KubeMeta) => meta.ownerReferences?.find((r) => r.controller) ?? meta.ownerReferences?.[0] ?? null;

function podResources(pod: KubePod, field: 'requests' | 'limits'): Amount {
  const containers = (pod.spec?.containers ?? []).reduce((sum, c) => add(sum, amountOf(c.resources?.[field])), ZERO);
  return (pod.spec?.initContainers ?? []).reduce((max, c) => peak(max, amountOf(c.resources?.[field])), containers);
}

function workloadOf(pod: KubePod, deploymentByReplicaSet: ReadonlyMap<string, string>): [string, string, string] {
  const namespace = pod.metadata.namespace ?? '';
  const owner = controllerOf(pod.metadata);
  if (!owner) return [namespace, 'Pod', pod.metadata.name];
  const deployment = owner.kind === 'ReplicaSet' ? deploymentByReplicaSet.get(`${namespace}/${owner.name}`) : undefined;
  return deployment ? [namespace, 'Deployment', deployment] : [namespace, owner.kind, owner.name];
}

function forwardedLabels(labels: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(labels).filter(([k]) => FORWARDED_LABEL_PREFIXES.some((p) => k.startsWith(p))));
}

function mergeContainers(target: Map<string, ContainerTotals>, containers: readonly KubeContainer[], usage: ReadonlyMap<string, Amount> | undefined): void {
  for (const c of containers) {
    const current: ContainerTotals = target.get(c.name) ?? { requests: ZERO, limits: ZERO };
    const used = usage?.get(c.name);
    target.set(c.name, {
      requests: peak(current.requests, amountOf(c.resources?.requests)),
      limits: peak(current.limits, amountOf(c.resources?.limits)),
      usage: used ? (current.usage ? peak(current.usage, used) : used) : current.usage,
    });
  }
}

export function aggregateSnapshot(s: KubeSnapshot): { nodes: ReportNodeDto[]; workloads: ReportWorkloadDto[] } {
  const deploymentByReplicaSet = new Map<string, string>();
  for (const rs of s.replicaSets) {
    const owner = controllerOf(rs.metadata);
    if (owner?.kind === 'Deployment') deploymentByReplicaSet.set(podKey(rs.metadata), owner.name);
  }
  const desired = new Map<string, number | null>();
  for (const d of s.deployments) desired.set(workloadKey(d.metadata.namespace ?? '', 'Deployment', d.metadata.name), d.spec?.replicas ?? null);
  for (const d of s.statefulSets) desired.set(workloadKey(d.metadata.namespace ?? '', 'StatefulSet', d.metadata.name), d.spec?.replicas ?? null);
  for (const d of s.daemonSets) desired.set(workloadKey(d.metadata.namespace ?? '', 'DaemonSet', d.metadata.name), d.status?.desiredNumberScheduled ?? null);
  const hpas = new Map(
    s.hpas.map((h) => [
      workloadKey(h.metadata.namespace ?? '', h.spec.scaleTargetRef.kind, h.spec.scaleTargetRef.name),
      { minReplicas: h.spec.minReplicas ?? null, maxReplicas: h.spec.maxReplicas },
    ]),
  );
  const nodeUsage = new Map((s.nodeMetrics ?? []).map((m) => [m.metadata.name, amountOf(m.usage)]));
  const containerUsage = new Map((s.podMetrics ?? []).map((m) => [podKey(m.metadata), new Map((m.containers ?? []).map((c) => [c.name, amountOf(c.usage)]))]));

  const nodes = new Map<string, ReportNodeDto & { requests: Amount; limits: Amount }>();
  for (const n of s.nodes) {
    const labels = n.metadata.labels ?? {};
    const usage = nodeUsage.get(n.metadata.name);
    nodes.set(n.metadata.name, {
      name: n.metadata.name,
      providerId: n.spec?.providerID,
      internalIp: n.status?.addresses?.find((a) => a.type === 'InternalIP')?.address,
      instanceType: labels['node.kubernetes.io/instance-type'],
      role: 'node-role.kubernetes.io/control-plane' in labels || 'node-role.kubernetes.io/master' in labels ? 'control-plane' : 'worker',
      labels: forwardedLabels(labels),
      capacity: amountOf(n.status?.capacity),
      allocatable: amountOf(n.status?.allocatable),
      requests: ZERO,
      limits: ZERO,
      ...(usage ? { usage } : {}),
      podCount: 0,
    });
  }

  const workloads = new Map<string, WorkloadTotals>();
  for (const pod of s.pods) {
    if (pod.status?.phase === 'Succeeded' || pod.status?.phase === 'Failed') continue;
    const requests = podResources(pod, 'requests');
    const limits = podResources(pod, 'limits');
    const node = nodes.get(pod.spec?.nodeName ?? '');
    if (node) {
      node.requests = add(node.requests, requests);
      node.limits = add(node.limits, limits);
      node.podCount++;
    }
    const id = workloadOf(pod, deploymentByReplicaSet);
    const key = workloadKey(...id);
    const w: WorkloadTotals = workloads.get(key) ?? { id, podCount: 0, requests: ZERO, limits: ZERO, containers: new Map() };
    const usage = containerUsage.get(podKey(pod.metadata));
    w.podCount++;
    w.requests = add(w.requests, requests);
    w.limits = add(w.limits, limits);
    if (usage) w.usage = [...usage.values()].reduce(add, w.usage ?? ZERO);
    mergeContainers(w.containers, pod.spec?.containers ?? [], usage);
    workloads.set(key, w);
  }

  return {
    nodes: [...nodes.values()],
    workloads: [...workloads].map(([key, w]) => ({
      namespace: w.id[0],
      kind: w.id[1],
      name: w.id[2],
      desiredReplicas: desired.get(key) ?? null,
      podCount: w.podCount,
      requests: w.requests,
      limits: w.limits,
      ...(w.usage ? { usage: w.usage } : {}),
      hpa: hpas.get(key) ?? null,
      containers: [...w.containers].map(([name, c]): ReportContainerDto => ({ name, requests: c.requests, limits: c.limits, ...(c.usage ? { usage: c.usage } : {}) })),
    })),
  };
}
