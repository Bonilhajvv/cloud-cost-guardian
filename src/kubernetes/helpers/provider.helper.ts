import { KubernetesProvider } from '../../common/enums';

export function instanceIdFromProviderId(providerId: string | undefined | null): string | null {
  if (!providerId?.startsWith('aws://')) return null;
  const last = providerId.split('/').pop() ?? '';
  return /^i-[0-9a-f]+$/.test(last) ? last : null;
}

export function detectProvider(nodes: { providerId?: string; labels?: Record<string, string> }[]): KubernetesProvider {
  const labels = nodes.flatMap((n) => Object.keys(n.labels ?? {}));
  if (labels.some((l) => l.startsWith('eks.amazonaws.com/'))) return KubernetesProvider.EKS;
  if (labels.some((l) => l.startsWith('cloud.google.com/gke'))) return KubernetesProvider.GKE;
  if (labels.some((l) => l.startsWith('kubernetes.azure.com/'))) return KubernetesProvider.AKS;
  if (nodes.some((n) => n.providerId?.startsWith('aws://'))) return KubernetesProvider.SELF_MANAGED;
  return nodes.length ? KubernetesProvider.SELF_MANAGED : KubernetesProvider.UNKNOWN;
}
