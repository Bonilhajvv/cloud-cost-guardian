import { ContainerSpec, ResourceAmount } from '../interfaces/kubernetes-analysis.interface';

const setOrNull = (value: number | null | undefined): number | null => (value === null || value === undefined || value <= 0 ? null : value);

const amount = (a: { cpuCores?: number | null; memoryBytes?: number | null }): ResourceAmount => ({ cpuCores: setOrNull(a.cpuCores), memoryBytes: setOrNull(a.memoryBytes) });

export function containerSpecs(containers: { name: string; requests: { cpuCores?: number | null; memoryBytes?: number | null }; limits: { cpuCores?: number | null; memoryBytes?: number | null } }[]): ContainerSpec[] {
  return containers.map((c) => ({ name: c.name, requests: amount(c.requests), limits: amount(c.limits) }));
}
