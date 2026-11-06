import { buildDailyUsage } from './build-daily-usage.helper';

describe('buildDailyUsage', () => {
  it('groups hourly series into daily average and max', () => {
    const d1 = Date.parse('2026-11-01T01:00:00Z');
    const d1b = Date.parse('2026-11-01T02:00:00Z');
    const d2 = Date.parse('2026-11-02T01:00:00Z');
    const result = buildDailyUsage(
      { timestamps: [d1, d1b, d2], values: [10, 20, 5] },
      { timestamps: [d1, d1b, d2], values: [40, 70, 9] },
    );

    expect(result).toEqual([
      { date: '2026-11-01', average: 15, max: 70 },
      { date: '2026-11-02', average: 5, max: 9 },
    ]);
  });

  it('returns an empty list without data', () => {
    expect(buildDailyUsage(undefined)).toEqual([]);
  });
});
