import { Global, Inject, Injectable, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import * as schema from './schema';

export const PG_POOL = Symbol('PG_POOL');
export const DB = Symbol('DB');

export type Database = NodePgDatabase<typeof schema>;
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbExecutor = Database | DbTransaction;

const poolLogger = new Logger('PgPool');

// An idle client that loses its connection (database restart, network blip) makes the pool emit 'error'.
// Without a listener Node treats that as an unhandled 'error' event and the whole process exits.
export function createPool(config: PoolConfig): Pool {
  const pool = new Pool(config);
  pool.on('error', (error) => {
    poolLogger.error(`Idle database client error: ${error.message}`);
  });
  return pool;
}

@Injectable()
class PoolShutdown implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ENV],
      useFactory: (env: Env) =>
        createPool({
          connectionString: env.DATABASE_URL,
          max: 10,
          connectionTimeoutMillis: 5000,
          statement_timeout: 15000,
        }),
    },
    { provide: DB, inject: [PG_POOL], useFactory: (pool: Pool) => drizzle(pool, { schema }) },
    PoolShutdown,
  ],
  exports: [DB, PG_POOL],
})
export class DbModule {}
