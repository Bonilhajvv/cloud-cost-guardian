import { connectionLimit, defaultMaxConnections } from './max-connections.helper';

describe('max_connections', () => {
  it.each([
    ['postgres', '16.4', 8, 901],
    ['postgres', '16.4', 64, 5000],
    ['aurora-postgresql', '16.4', 16, 1802],
    ['mysql', '8.4.3', 8, 682],
    ['mariadb', '11.4.4', 8, 341],
    ['mariadb', '10.4.34', 8, 682],
  ])('default of %s %s with %i GiB', (engine, engineVersion, memory, limit) => {
    expect(connectionLimit({ engine, engineVersion }, memory, { source: 'DEFAULT' })).toEqual({ limit, fixed: false, assumed: false });
  });

  it('does not guess other engines, formulas or memory', () => {
    const pg = { engine: 'postgres', engineVersion: '16.4' };
    expect(defaultMaxConnections('aurora-mysql', '8.0')).toBeNull();
    expect(connectionLimit(pg, null, { source: 'DEFAULT' })).toBeNull();
    expect(connectionLimit(pg, 8, { source: 'PARAMETER_GROUP', value: 'GREATEST({log(DBInstanceClassMemory/805306368)*45},10)' })).toBeNull();
    expect(connectionLimit(pg, 8, undefined)).toMatchObject({ assumed: true });
  });

  it('reads fixed values and custom formulas', () => {
    const pg = { engine: 'postgres', engineVersion: '16.4' };
    expect(connectionLimit(pg, null, { source: 'PARAMETER_GROUP', value: '500' })).toEqual({ limit: 500, fixed: true, assumed: false });
    expect(connectionLimit(pg, 8, { source: 'PARAMETER_GROUP', value: 'LEAST({DBInstanceClassMemory/9531392},300)' })?.limit).toBe(300);
  });
});
