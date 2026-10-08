import { csvCell, csvRow } from './csv';

describe('csvCell', () => {
  it('leaves plain text alone and renders null/undefined as empty', () => {
    expect(csvCell('hello')).toBe('hello');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(42)).toBe('42');
  });

  it('quotes cells containing commas, quotes or line breaks and doubles inner quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it.each(['=1+1', '+1+1', '-2+3', '@SUM(1)', '\tcmd', '\rcmd', '\ncmd'])('neutralizes the formula-leading cell %j with a leading apostrophe', (value) => {
    expect(csvCell(value).startsWith("'") || csvCell(value).startsWith('"\'')).toBe(true);
    expect(csvCell(value)).not.toMatch(/^"?[=+\-@\t\r\n]/);
  });

  it('neutralizes first and then quotes', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
  });

  it('serializes objects as JSON', () => {
    expect(csvCell({ role: { before: 'staff', after: 'admin' } })).toBe('"{""role"":{""before"":""staff"",""after"":""admin""}}"');
  });
});

describe('csvRow', () => {
  it('joins cells with commas and ends with CRLF', () => {
    expect(csvRow(['a', 'b,c', null])).toBe('a,"b,c",\r\n');
  });
});
