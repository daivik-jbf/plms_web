import { Logger } from '@nestjs/common';
import type { MailMessage, Mailer } from './mailer';

export class ConsoleMailer implements Mailer {
  private readonly logger = new Logger(ConsoleMailer.name);

  async send(message: MailMessage): Promise<void> {
    this.logger.log(`Email to ${message.to} — ${message.subject}\n${message.text}`);
  }
}
