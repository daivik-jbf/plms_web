import { describe, expect, it } from 'vitest';
import { formatBytes, formatDate, formatDateTime, formatDuration, formatExactUtc, formatValue } from './format';

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

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [10 * 1024, '10 KB'],
    [412 * 1024 ** 2, '412 MB'],
    [1_288_490_189, '1.2 GB'],
    [2 * 1024 ** 3, '2 GB'],
  ])('%i bytes is %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

describe('formatDuration', () => {
  it.each([
    [null, '—'],
    [0, '0:00'],
    [65, '1:05'],
    [724, '12:04'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
  ])('%s is %s', (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});
