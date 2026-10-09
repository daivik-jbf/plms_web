import { parseEnv } from './env';

const base = {
  DATABASE_URL: 'postgres://localhost:5432/x',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  WEB_ORIGIN: 'http://localhost:5173',
};

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.MAIL_TRANSPORT).toBe('console');
    expect(env.THROTTLE_ENABLED).toBe(true);
    expect(env.TRUST_PROXY).toBe(false);
  });

  it('rejects a short JWT secret', () => {
    expect(() => parseEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('requires SMTP_URL when the transport is smtp', () => {
    expect(() => parseEnv({ ...base, MAIL_TRANSPORT: 'smtp' })).toThrow(/SMTP_URL/);
  });

  it('refuses the console mailer in production because it logs invite links', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'production', MAIL_TRANSPORT: 'console' })).toThrow(
      /MAIL_TRANSPORT/,
    );
  });

  it('defaults the audit export cap to 50,000 rows and accepts an override', () => {
    expect(parseEnv(base).AUDIT_EXPORT_MAX_ROWS).toBe(50_000);
    expect(parseEnv({ ...base, AUDIT_EXPORT_MAX_ROWS: '5' }).AUDIT_EXPORT_MAX_ROWS).toBe(5);
    expect(() => parseEnv({ ...base, AUDIT_EXPORT_MAX_ROWS: '0' })).toThrow(/AUDIT_EXPORT_MAX_ROWS/);
  });

  it('defaults the storage settings for development', () => {
    const env = parseEnv(base);
    expect(env.STORAGE_DRIVER).toBe('local');
    expect(env.STORAGE_LOCAL_DIR).toBe('./.storage');
    expect(env.STORAGE_SIGNING_SECRET).toBeUndefined();
  });

  it('rejects a short signing secret', () => {
    expect(() => parseEnv({ ...base, STORAGE_SIGNING_SECRET: 'short' })).toThrow(/STORAGE_SIGNING_SECRET/);
  });

  it('accepts the r2 driver only with all four Cloudflare settings', () => {
    const r2 = { ...base, STORAGE_DRIVER: 'r2' };
    expect(() => parseEnv(r2)).toThrow(/R2_ACCOUNT_ID/);
    const complete = { ...r2, R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET: 'd' };
    expect(parseEnv(complete).STORAGE_DRIVER).toBe('r2');
    expect(() => parseEnv({ ...complete, R2_BUCKET: '' })).toThrow(/R2_BUCKET/);
  });

  it('refuses the local storage driver in production', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'production', MAIL_TRANSPORT: 'smtp', SMTP_URL: 'smtp://x' })).toThrow(/STORAGE_DRIVER/);
  });
});
