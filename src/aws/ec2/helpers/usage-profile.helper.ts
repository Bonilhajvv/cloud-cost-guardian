import { round } from '../../../common/helpers/stats.helper';
import { Ec2UtilizationMetrics } from '../../metrics/interfaces/utilization-metrics.interface';
import { Ec2InstanceDetails } from '../interfaces/ec2-instance.interface';
import { UsageProfile } from '../interfaces/usage-profile.interface';

function used(percent: number | null | undefined, capacity: number | null): number | null {
  if (percent === null || percent === undefined || capacity === null) return null;
  return round((percent / 100) * capacity);
}

export function buildUsageProfile(
  instance: Ec2InstanceDetails,
  metrics: Ec2UtilizationMetrics | null,
  networkMbPerDay: number | null,
): UsageProfile {
  const cpu = metrics?.cpu;
  const memory = metrics?.memory;
  const mem = memory?.available ? memory.usedPercent : null;
  const credits = metrics?.cpuCredits ?? null;
  return {
    periodDays: metrics?.periodDays ?? null,
    datapoints: cpu?.datapoints ?? 0,
    cpu: {
      vcpuAvailable: instance.vcpu,
      average: cpu?.average ?? null,
      p50: cpu?.p50 ?? null,
      p95: cpu?.p95 ?? null,
      p99: cpu?.p99 ?? null,
      max: cpu?.max ?? null,
      p95VcpuUsed: used(cpu?.p95, instance.vcpu),
      peakVcpuUsed: used(cpu?.max, instance.vcpu),
    },
    memory: {
      available: !!mem,
      source: memory?.available ? (memory.source ?? 'CLOUDWATCH_AGENT') : null,
      gbAvailable: instance.memoryGiB,
      average: mem?.average ?? null,
      p95: mem?.p95 ?? null,
      max: mem?.max ?? null,
      p95GbUsed: used(mem?.p95, instance.memoryGiB),
      peakGbUsed: used(mem?.max, instance.memoryGiB),
    },
    networkMbPerDay,
    diskMaxUsedPercent: metrics?.disk?.available ? metrics.disk.maxUsedPercent : null,
    cpuCredits: credits ? { balanceMin: credits.balanceMin, surplusCharged: credits.surplusChargedTotal } : null,
    daily: { cpu: metrics?.cpuDaily ?? [], memory: metrics?.memoryDaily ?? [] },
  };
}
