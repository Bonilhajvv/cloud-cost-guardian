import { KubernetesProvider } from '../../common/enums';
import { renderAgentManifest, renderHelmValues } from './manifest.helper';
import { detectProvider, instanceIdFromProviderId } from './provider.helper';
import { generateInstallToken, parseAgentToken, sha256, signAgentToken } from './tokens.helper';

const SECRET = 'test-secret-with-at-least-32-characters!!';
const CLUSTER = '5fa4427c-3634-4057-889e-dfa47ae95800';

describe('agent tokens', () => {
  it('signs and verifies a token bound to cluster and version', () => {
    const token = signAgentToken(SECRET, CLUSTER, 3);
    expect(token.startsWith('ccg_agent_')).toBe(true);
    expect(parseAgentToken(SECRET, token)).toEqual({ clusterId: CLUSTER, version: 3 });
  });

  it('rejects tampered, foreign and malformed tokens', () => {
    const token = signAgentToken(SECRET, CLUSTER, 1);
    expect(parseAgentToken(SECRET, token.replace('.1.', '.2.'))).toBeNull();
    expect(parseAgentToken('another-secret-with-at-least-32-chars!!', token)).toBeNull();
    expect(parseAgentToken(SECRET, 'ccg_agent_garbage')).toBeNull();
    expect(parseAgentToken(SECRET, 'Bearer x')).toBeNull();
  });

  it('generates random install tokens and stores only hashes', () => {
    const a = generateInstallToken();
    expect(a).toMatch(/^ccg_inst_[0-9a-f]{48}$/);
    expect(a).not.toBe(generateInstallToken());
    expect(sha256(a)).toHaveLength(64);
  });
});

describe('provider helpers', () => {
  it('extracts the EC2 instance id from providerID', () => {
    expect(instanceIdFromProviderId('aws:///us-east-1a/i-0ea49e6ecda54b39d')).toBe('i-0ea49e6ecda54b39d');
    expect(instanceIdFromProviderId('k3s://node-1')).toBeNull();
    expect(instanceIdFromProviderId(undefined)).toBeNull();
  });

  it('detects the cluster provider from node labels and providerID', () => {
    expect(detectProvider([{ labels: { 'eks.amazonaws.com/nodegroup': 'ng' } }])).toBe(KubernetesProvider.EKS);
    expect(detectProvider([{ labels: { 'cloud.google.com/gke-nodepool': 'p' } }])).toBe(KubernetesProvider.GKE);
    expect(detectProvider([{ providerId: 'aws:///us-east-1a/i-1' }])).toBe(KubernetesProvider.SELF_MANAGED);
    expect(detectProvider([])).toBe(KubernetesProvider.UNKNOWN);
  });
});

describe('manifest rendering', () => {
  const params = { clusterId: CLUSTER, clusterName: 'abrappe', agentToken: 'ccg_agent_x.1.y', apiUrl: 'https://api.example', image: 'reg/ccg:1' };

  it('renders a read-only manifest with the agent token and kubectl install label', () => {
    const yaml = renderAgentManifest(params);
    expect(yaml).toContain('CCG_AGENT_TOKEN: "ccg_agent_x.1.y"');
    expect(yaml).toContain('ccg.io/install-method: kubectl');
    expect(yaml).toContain('image: "reg/ccg:1"');
    expect(yaml).not.toMatch(/secrets|configmaps|create|delete|patch|update/);
    expect(yaml.split('\n---\n')).toHaveLength(6);
  });

  it('renders helm values', () => {
    expect(renderHelmValues(params)).toContain('agentToken: "ccg_agent_x.1.y"');
  });
});
