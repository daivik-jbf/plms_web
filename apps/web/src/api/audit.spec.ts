import { describe, expect, it } from 'vitest';
import { auditQueryString, filtersFromParams, filtersToParams } from './audit';

describe('audit filters', () => {
  it('round-trips through URL parameters and drops empty values', () => {
    const params = new URLSearchParams('involving=u1&category=accounts&q=anita&includePlayback=true&from=2026-03-02&to=2026-03-03&junk=1');
    const filters = filtersFromParams(params);
    expect(filters).toEqual({ involving: 'u1', category: 'accounts', q: 'anita', includePlayback: true, from: '2026-03-02', to: '2026-03-03' });
    expect(filtersToParams(filters).toString()).toBe('involving=u1&category=accounts&from=2026-03-02&to=2026-03-03&q=anita&includePlayback=true');
    expect(filtersToParams({}).toString()).toBe('');
    expect(filtersFromParams(new URLSearchParams('q=&actorId=')).q).toBeUndefined();
  });

  it('builds the API query: whole-day local range as ISO instants, paging extras, and omits includePlayback when off', () => {
    const query = new URLSearchParams(auditQueryString({ actorId: 'a1', from: '2026-03-02', to: '2026-03-02', q: 'x y' }, { limit: 50, cursor: 'abc' }).slice(1));
    expect(query.get('actorId')).toBe('a1');
    expect(query.get('q')).toBe('x y');
    expect(query.get('limit')).toBe('50');
    expect(query.get('cursor')).toBe('abc');
    expect(query.get('includePlayback')).toBeNull();
    expect(new Date(query.get('from')!).getTime()).toBe(new Date('2026-03-02T00:00:00').getTime());
    expect(new Date(query.get('to')!).getTime()).toBe(new Date('2026-03-02T23:59:59.999').getTime());
    expect(new URLSearchParams(auditQueryString({ includePlayback: true }).slice(1)).get('includePlayback')).toBe('true');
  });

  it('ignores malformed dates from a hand-edited URL instead of throwing', () => {
    expect(auditQueryString({ from: 'yesterday', to: '2026-13-45' })).toBe('');
  });

  it('ignores impossible dates instead of rolling them over into the next month', () => {
    expect(auditQueryString({ from: '2026-02-31', to: '2026-04-31' })).toBe('');
    expect(new URLSearchParams(auditQueryString({ from: '2028-02-29' }).slice(1)).get('from')).not.toBeNull();
  });

  it('ignores years below 1000 (a date input mid-way through typing the year)', () => {
    expect(auditQueryString({ from: '0002-03-02', to: '0999-12-31' })).toBe('');
    expect(new URLSearchParams(auditQueryString({ from: '1000-01-01' }).slice(1)).get('from')).not.toBeNull();
  });

  it('returns an empty string when there is nothing to send', () => {
    expect(auditQueryString({})).toBe('');
  });
});
