import { NODE_ROLE_NAME_TOKENS } from '../constants/cluster-name.constant';

function stripRoleTokens(name: string): string {
  return name
    .toLowerCase()
    .split(/[-_]/)
    .filter((t) => t && !NODE_ROLE_NAME_TOKENS.includes(t) && !/^\d+$/.test(t))
    .join('-');
}

export function deriveClusterName(names: readonly string[]): string | null {
  const derived = new Set(names.map(stripRoleTokens));
  if (derived.size !== 1) return null;
  const [name] = derived;
  return name || null;
}
