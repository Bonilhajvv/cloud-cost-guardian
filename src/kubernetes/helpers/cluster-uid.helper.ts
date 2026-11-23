export const CLUSTER_UID_MISMATCH = Symbol('CLUSTER_UID_MISMATCH');

export function boundClusterUid(stored: string | null, reported: string | undefined): string | null | typeof CLUSTER_UID_MISMATCH {
  if (!reported) return stored;
  if (!stored) return reported;
  return stored === reported ? stored : CLUSTER_UID_MISMATCH;
}
