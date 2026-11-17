import { extendedSupportYear, inExtendedSupport, lifecycleFor, majorVersionOf } from './rds-lifecycle.helper';

const lifecycle = (engine: string, majorVersion: string, standardSupportEnd: string) => ({ engine, majorVersion, standardSupportEnd, extendedSupportEnd: null });

describe('RDS lifecycle helpers', () => {
  it.each([
    ['13.15', ['13', '14'], '13'],
    ['8.0.35', ['5.7', '8.0', '8.4'], '8.0'],
    ['10.11.6', ['10.6', '10.11', '11.4'], '10.11'],
    ['9.6.1', ['10', '11'], null],
  ])('major version of %s', (version, majors, expected) => {
    expect(majorVersionOf(version, majors)).toBe(expected);
  });

  it('finds the lifecycle of the engine and tells the Extended Support year', () => {
    const all = [lifecycle('postgres', '13', '2026-02-28T23:59:59Z'), lifecycle('mysql', '13', '2030-01-01T00:00:00Z')];
    const pg13 = lifecycleFor('postgres', '13.15', all);

    expect(pg13?.engine).toBe('postgres');
    expect(inExtendedSupport(pg13, new Date('2026-11-16'))).toBe(true);
    expect(inExtendedSupport(pg13, new Date('2026-01-01'))).toBe(false);
    expect(inExtendedSupport(null, new Date())).toBe(false);
    expect(extendedSupportYear(pg13!, new Date('2026-11-16'))).toBe('Year 1, Year 2');
    expect(extendedSupportYear(pg13!, new Date('2028-03-02'))).toBe('Year 3');
  });
});
