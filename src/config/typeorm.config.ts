import { join } from 'path';
import { DataSourceOptions } from 'typeorm';

export function buildTypeOrmOptions(env: {
  DATABASE_URL: string;
  DATABASE_SSL: boolean;
  DATABASE_POOL_SIZE: number;
}): DataSourceOptions {
  return {
    type: 'postgres',
    url: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
    extra: { max: env.DATABASE_POOL_SIZE },
    entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
    migrations: [join(__dirname, '..', 'database', 'migrations', '*.{ts,js}')],
    synchronize: false,
    migrationsRun: false,
  };
}
