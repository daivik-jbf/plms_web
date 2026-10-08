import { tooManyRowsMessage } from './audit-export.service';

describe('tooManyRowsMessage', () => {
  it('prints the cap with a thousands separator', () => {
    expect(tooManyRowsMessage(50_000)).toBe('Too many rows to export (limit 50,000). Narrow the filters.');
    expect(tooManyRowsMessage(1_234_567)).toBe('Too many rows to export (limit 1,234,567). Narrow the filters.');
    expect(tooManyRowsMessage(5)).toBe('Too many rows to export (limit 5). Narrow the filters.');
  });
});
