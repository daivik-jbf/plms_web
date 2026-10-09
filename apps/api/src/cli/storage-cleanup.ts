import '../config/load-env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { UploadCleanupService } from '../media/upload-cleanup.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const { removed } = await app.get(UploadCleanupService).run();
    console.log(`Removed ${removed} abandoned upload${removed === 1 ? '' : 's'}.`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
