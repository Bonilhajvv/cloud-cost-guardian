import { boundClusterUid, CLUSTER_UID_MISMATCH } from './cluster-uid.helper';

const PRD = '6f1c2a0e-1b2c-4d3e-8f90-123456789abc';
const HML = '0b7d9e21-3c4a-4f5b-9a8c-abcdef012345';

describe('boundClusterUid', () => {
  it('binds the first reported uid', () => {
    expect(boundClusterUid(null, PRD)).toBe(PRD);
  });

  it('accepts the same uid', () => {
    expect(boundClusterUid(PRD, PRD)).toBe(PRD);
  });

  it('rejects a different uid', () => {
    expect(boundClusterUid(PRD, HML)).toBe(CLUSTER_UID_MISMATCH);
  });

  it('keeps the stored uid when an older agent sends none', () => {
    expect(boundClusterUid(PRD, undefined)).toBe(PRD);
    expect(boundClusterUid(null, undefined)).toBeNull();
  });
});
