import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../config/typeorm.config';

try {
  process.loadEnvFile?.();
} catch {
}

export default new DataSource(
  buildTypeOrmOptions({
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://ccg:ccg@localhost:5432/ccg',
    DATABASE_SSL: process.env.DATABASE_SSL === 'true',
    DATABASE_POOL_SIZE: 2,
  }),
);
