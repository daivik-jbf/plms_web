import type { MailMessage, Mailer } from '../../src/mail/mailer';

export class MemoryMailer implements Mailer {
  sent: MailMessage[] = [];
  failNext = false;

  async send(message: MailMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('mail failure (test)');
    }
    this.sent.push(message);
  }

  last(): MailMessage | undefined {
    return this.sent.at(-1);
  }

  clear(): void {
    this.sent = [];
  }
}
