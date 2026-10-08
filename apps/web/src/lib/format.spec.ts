import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatExactUtc, formatValue } from './format';

describe('format', () => {
  it('prints an exact UTC time', () => {
    expect(formatExactUtc('2026-10-08T10:42:07.123Z')).toBe('2026-10-08 10:42:07 UTC');
  });

  it('prints local dates and times as readable text containing the year', () => {
    expect(formatDate('2026-10-08T10:42:07Z')).toMatch(/2026/);
    expect(formatDateTime('2026-10-08T10:42:07Z')).toMatch(/2026/);
  });

  it('shows strings as they are and everything else as JSON', () => {
    expect(formatValue('staff')).toBe('staff');
    expect(formatValue(3)).toBe('3');
    expect(formatValue(null)).toBe('null');
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
  });
});
