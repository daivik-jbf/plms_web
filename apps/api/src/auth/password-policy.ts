import { z } from 'zod';
import commonPasswords from './common-passwords.json';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

const COMMON = new Set<string>(commonPasswords);

export function checkPassword(password: string): string[] {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) {
    return [`Use at least ${PASSWORD_MIN_LENGTH} characters.`];
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return [`Use no more than ${PASSWORD_MAX_LENGTH} characters.`];
  }
  if (password.trim().length === 0) {
    return ['Password cannot be only spaces.'];
  }
  if (COMMON.has(password.toLowerCase())) {
    return ['That password is too common. Choose something less guessable.'];
  }
  return [];
}

export const passwordSchema = z.string().superRefine((password, ctx) => {
  for (const message of checkPassword(password)) {
    ctx.addIssue({ code: 'custom', message });
  }
});
