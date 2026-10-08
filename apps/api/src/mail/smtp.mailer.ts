import type { Transporter } from 'nodemailer';
import type { MailMessage, Mailer } from './mailer';

export class SmtpMailer implements Mailer {
  constructor(
    private readonly transport: Transporter,
    private readonly from: string,
    private readonly timeoutMs = 15_000,
  ) {}

  async send(message: MailMessage): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Sending email timed out')), this.timeoutMs);
    });
    try {
      await Promise.race([this.transport.sendMail({ from: this.from, ...message }), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
