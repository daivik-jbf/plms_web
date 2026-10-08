import type { MailMessage } from './mailer';

interface TemplateInput {
  name: string;
  link: string;
  expiresAt: Date;
}

type Template = Omit<MailMessage, 'to'>;

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const expiryText = (expiresAt: Date): string => `${expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

function build(subject: string, intro: string, action: string, { name, link, expiresAt }: TemplateInput): Template {
  const expiry = expiryText(expiresAt);
  const text = `Hello ${name},\n\n${intro}\n\n${action}: ${link}\n\nThis link works once and expires on ${expiry}.\nIf you were not expecting this email, you can ignore it.`;
  const html = `<p>Hello ${escapeHtml(name)},</p><p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(link)}">${escapeHtml(action)}</a></p><p>This link works once and expires on ${expiry}.<br>If you were not expecting this email, you can ignore it.</p>`;
  return { subject, text, html };
}

export const inviteEmail = (input: TemplateInput): Template =>
  build(
    'You have been invited to JBF Learning Management System',
    'You have been invited to join the JBF Learning Management System.',
    'Set your password',
    input,
  );

export const resetEmail = (input: TemplateInput): Template =>
  build(
    'Reset your JBF Learning Management System password',
    'We received a request to reset your password.',
    'Reset your password',
    input,
  );
