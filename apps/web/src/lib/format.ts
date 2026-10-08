const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso));
export const formatDate = (iso: string): string => dateOnly.format(new Date(iso));
export const formatExactUtc = (iso: string): string => `${new Date(iso).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
export const formatValue = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value));
