import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { AGENT_TOKEN_PREFIX, INSTALL_TOKEN_PREFIX } from '../constants/kubernetes.constant';

export function generateInstallToken(): string {
  return `${INSTALL_TOKEN_PREFIX}${randomBytes(24).toString('hex')}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function signature(secret: string, clusterId: string, version: number): string {
  return createHmac('sha256', secret).update(`${clusterId}.${version}`).digest('base64url');
}

export function signAgentToken(secret: string, clusterId: string, version: number): string {
  return `${AGENT_TOKEN_PREFIX}${clusterId}.${version}.${signature(secret, clusterId, version)}`;
}

export function parseAgentToken(secret: string, token: string): { clusterId: string; version: number } | null {
  if (!token.startsWith(AGENT_TOKEN_PREFIX)) return null;
  const [clusterId, versionText, sig] = token.slice(AGENT_TOKEN_PREFIX.length).split('.');
  const version = Number(versionText);
  if (!clusterId || !sig || !Number.isInteger(version)) return null;
  const expected = Buffer.from(signature(secret, clusterId, version));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return { clusterId, version };
}
