import '../config/load-env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DB, type Database } from '../db/db.module';
import { InvitesService } from '../invites/invites.service';
import { bootstrapAdmin } from './bootstrap-admin';

async function main(): Promise<void> {
  const [email, name] = process.argv.slice(2);
  if (!email || !name) {
    console.error('Usage: npm run admin:create -w @jbf/api -- <email> "<Full Name>"');
    process.exit(1);
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const link = await bootstrapAdmin({ invites: app.get(InvitesService), db: app.get<Database>(DB) }, email, name);
    console.log(`Open this link to set the first Admin's password (valid for 7 days):\n${link}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
