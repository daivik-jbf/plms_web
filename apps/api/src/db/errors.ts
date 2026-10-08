export function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } } | null;
  return candidate?.code === '23505' || candidate?.cause?.code === '23505';
}

// Postgres rejected a value as malformed or out of range (invalid text representation, datetime format, datetime field overflow).
export function isInvalidInputValue(error: unknown): boolean {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const codes = ['22007', '22008', '22P02'];
  return codes.includes(candidate?.code as string) || codes.includes(candidate?.cause?.code as string);
}
