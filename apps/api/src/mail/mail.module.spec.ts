import { createSmtpTransport, SMTP_TIMEOUTS } from './mail.module';

describe('createSmtpTransport', () => {
  it('combines the connection URL with explicit timeouts', () => {
    const transport = createSmtpTransport('smtp://user:pass@mail.example.com:2525');
    const options = (transport.transporter as unknown as { options: Record<string, unknown> }).options;
    expect(options).toMatchObject({ host: 'mail.example.com', port: 2525, auth: { user: 'user', pass: 'pass' }, ...SMTP_TIMEOUTS });
    expect(SMTP_TIMEOUTS).toEqual({ connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 });
    transport.close();
  });
});
