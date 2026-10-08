import { createTransport } from 'nodemailer';
import { SmtpMailer } from './smtp.mailer';

describe('SmtpMailer', () => {
  it('sends the message through the transport with the configured sender', async () => {
    const mailer = new SmtpMailer(createTransport({ jsonTransport: true }), 'JBF <no-reply@example.com>');
    await expect(
      mailer.send({ to: 'a@example.com', subject: 'Hi', text: 'text', html: '<p>html</p>' }),
    ).resolves.toBeUndefined();
  });

  it('fails instead of hanging when the transport never answers', async () => {
    const hanging = { sendMail: () => new Promise(() => undefined) } as never;
    const mailer = new SmtpMailer(hanging, 'JBF <no-reply@example.com>', 50);
    await expect(mailer.send({ to: 'a@example.com', subject: 'Hi', text: 't', html: 'h' })).rejects.toThrow(/timed out/);
  });
});
