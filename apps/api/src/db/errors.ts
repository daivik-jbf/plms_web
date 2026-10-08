export function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } } | null;
  return candidate?.code === '23505' || candidate?.cause?.code === '23505';
}
