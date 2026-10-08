import { emailSchema, nameSchema } from './fields';

describe('emailSchema', () => {
  it('trims and lowercases', () => {
    expect(emailSchema.parse('  Anita@Example.COM ')).toBe('anita@example.com');
  });

  it.each(['', 'not-an-email', 'a@b', 'a b@example.com'])('rejects %p', (value) => {
    expect(emailSchema.safeParse(value).success).toBe(false);
  });
});

describe('nameSchema', () => {
  it.each(["O'Brien", 'Anne-Marie', 'José Núñez', 'Zoë', 'Łukasz', '李小龍', 'D’Angelo'])('accepts %p', (value) => {
    expect(nameSchema.safeParse(value).success).toBe(true);
  });

  it.each(['', '   ', 'R2D2', 'Bob <script>', '-Leading', 'a'.repeat(101), 'Line\nBreak'])('rejects %p', (value) => {
    expect(nameSchema.safeParse(value).success).toBe(false);
  });
});
