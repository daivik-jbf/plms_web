import { z } from 'zod';

const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} '’-]*$/u;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email('Enter a valid email address.'));

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(100, 'Name must be 100 characters or fewer.')
  .regex(NAME_PATTERN, 'Names can contain letters, spaces, hyphens and apostrophes.');
