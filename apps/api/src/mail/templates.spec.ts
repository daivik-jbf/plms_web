import { inviteEmail, resetEmail } from './templates';

const expiresAt = new Date('2026-10-15T10:00:00Z');

describe('email templates', () => {
  it('invite contains the link and expiry in both text and html', () => {
    const mail = inviteEmail({ name: 'Anita', link: 'https://app.example/accept-invite?token=abc', expiresAt });
    expect(mail.subject).toContain('JBF Learning Management System');
    expect(mail.text).toContain('https://app.example/accept-invite?token=abc');
    expect(mail.text).toContain('2026-10-15');
    expect(mail.html).toContain('href="https://app.example/accept-invite?token=abc"');
  });

  it('escapes the name in html so an Admin cannot inject markup', () => {
    const mail = inviteEmail({ name: '<script>alert(1)</script>', link: 'https://x.example/?t=1', expiresAt });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });

  it('reset email states that it expires', () => {
    const mail = resetEmail({ name: 'Anita', link: 'https://x.example/reset?token=t', expiresAt });
    expect(mail.text).toContain('https://x.example/reset?token=t');
    expect(mail.text.toLowerCase()).toContain('expires');
  });
});
