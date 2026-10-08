import { Module } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { ConsoleMailer } from './console.mailer';
import { MAILER, type Mailer } from './mailer';
import { SmtpMailer } from './smtp.mailer';

@Module({
  providers: [
    {
      provide: MAILER,
      inject: [ENV],
      useFactory: (env: Env): Mailer =>
        env.MAIL_TRANSPORT === 'smtp' && env.SMTP_URL
          ? new SmtpMailer(createTransport(env.SMTP_URL), env.MAIL_FROM)
          : new ConsoleMailer(),
    },
  ],
  exports: [MAILER],
})
export class MailModule {}
