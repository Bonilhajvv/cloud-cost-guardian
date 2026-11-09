import { instanceIdFromProviderId } from './provider.helper';

export function resolveNodeInstanceIds(
  nodes: { name: string; providerId?: string; internalIp?: string }[],
  instancesByIp: { instanceId: string; privateIp: string }[],
): Map<string, string | null> {
  const idsByIp = new Map<string, Set<string>>();
  for (const i of instancesByIp) idsByIp.set(i.privateIp, (idsByIp.get(i.privateIp) ?? new Set()).add(i.instanceId));
  return new Map(
    nodes.map((n) => {
      const fromProvider = instanceIdFromProviderId(n.providerId);
      if (fromProvider) return [n.name, fromProvider];
      const matches = n.internalIp ? idsByIp.get(n.internalIp) : undefined;
      return [n.name, matches?.size === 1 ? [...matches][0] : null];
    }),
  );
}

export function ipsToResolve(nodes: { providerId?: string; internalIp?: string }[]): string[] {
  return [...new Set(nodes.filter((n) => !instanceIdFromProviderId(n.providerId) && n.internalIp).map((n) => n.internalIp as string))];
}
