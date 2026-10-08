// Cells that start with these characters are executed as formulas by spreadsheet programs. Audit labels can
// contain attacker-typed text (failed sign-ins store the typed email), so such cells get a leading apostrophe.
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const csvRow = (values: unknown[]): string => `${values.map(csvCell).join(',')}\r\n`;
