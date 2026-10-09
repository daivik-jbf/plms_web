import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { RolesGuard } from './auth/roles.guard';
import { ConfigModule, ENV } from './config/config.module';
import type { Env } from './config/env';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { InvitesModule } from './invites/invites.module';
import { MailModule } from './mail/mail.module';
import { MediaModule } from './media/media.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        throttlers: [{ ttl: 60_000, limit: 120 }],
        skipIf: () => !env.THROTTLE_ENABLED,
      }),
    }),
    DbModule,
    AuditModule,
    MailModule,
    StorageModule,
    AuthModule,
    HealthModule,
    InvitesModule,
    UsersModule,
    MediaModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
