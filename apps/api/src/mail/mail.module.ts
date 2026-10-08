import { Module } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { ConsoleMailer } from './console.mailer';
import { MAILER, type Mailer } from './mailer';
import { SmtpMailer } from './smtp.mailer';

// Explicit timeouts so a silent or slow SMTP server fails fast instead of holding a socket for minutes.
export const SMTP_TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 };

export function createSmtpTransport(url: string): Transporter {
  return createTransport({ url, ...SMTP_TIMEOUTS });
}

@Module({
  providers: [
    {
      provide: MAILER,
      inject: [ENV],
      useFactory: (env: Env): Mailer =>
        env.MAIL_TRANSPORT === 'smtp' && env.SMTP_URL
          ? new SmtpMailer(createSmtpTransport(env.SMTP_URL), env.MAIL_FROM)
          : new ConsoleMailer(),
    },
  ],
  exports: [MAILER],
})
export class MailModule {}
