import { isLongStopped, parseStoppedAt } from './stopped-at.helper';

describe('parseStoppedAt', () => {
  it('reads the timestamp AWS writes in StateTransitionReason', () => {
    expect(parseStoppedAt('User initiated (2026-11-09 14:42:28 GMT)')).toBe('2026-11-09T14:42:28.000Z');
  });

  it('returns null when there is no readable timestamp', () => {
    expect(parseStoppedAt('')).toBeNull();
    expect(parseStoppedAt(undefined)).toBeNull();
    expect(parseStoppedAt('Server.ScheduledStop')).toBeNull();
  });
});

describe('isLongStopped', () => {
  const now = new Date('2026-11-16T14:42:28.000Z');

  it('is true for a stopped instance at or beyond the minimum days', () => {
    expect(isLongStopped({ state: 'stopped', stoppedAt: '2026-11-09T14:42:28.000Z' }, now)).toBe(true);
  });

  it('is false for recent stops, unknown dates or running instances', () => {
    expect(isLongStopped({ state: 'stopped', stoppedAt: '2026-11-10T00:00:00.000Z' }, now)).toBe(false);
    expect(isLongStopped({ state: 'stopped', stoppedAt: null }, now)).toBe(false);
    expect(isLongStopped({ state: 'running', stoppedAt: '2026-01-01T00:00:00.000Z' }, now)).toBe(false);
  });
});
