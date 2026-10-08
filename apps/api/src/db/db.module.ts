import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import * as schema from './schema';

export const PG_POOL = Symbol('PG_POOL');
export const DB = Symbol('DB');

export type Database = NodePgDatabase<typeof schema>;
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbExecutor = Database | DbTransaction;

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
        new Pool({
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
