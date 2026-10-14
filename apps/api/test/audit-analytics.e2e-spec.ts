import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { auditLog, type User } from '../src/db/schema';
import type { Database } from '../src/db/db.module';
import { bearer, loginMobile, type Session } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { seedAudit } from './helpers/audit';
import { createUser } from './helpers/users';

describe('audit analytics and report', () => {
  let app: NestExpressApplication;
  let db: Database;
  let adminUser: User;
  let admin: Session;
  let staff: Session;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    adminUser = await createUser(db, { role: 'admin', name: 'Anita Rao' });
    admin = await loginMobile(app, adminUser.email);
    staff = await loginMobile(app, (await createUser(db, { role: 'staff' })).email);
  });

  afterAll(() => app.close());

  // A period far from every other test's data, so these counts are exact.
  const FROM = '2031-03-01T00:00:00.000Z';
  const TO = '2031-03-03T23:59:59.999Z';
  const query = `?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`;
  const at = (iso: string) => new Date(iso);

  it('is Admin-only', async () => {
    await request(app.getHttpServer()).get('/api/audit/analytics').expect(401);
    await request(app.getHttpServer()).get('/api/audit/analytics').set(...bearer(staff)).expect(403);
    await request(app.getHttpServer()).get('/api/audit/report.csv').set(...bearer(staff)).expect(403);
  });

  it('counts events, content changes by kind, categories, security events and busy people inside the period only', async () => {
    const actorId = randomUUID();
    await seedAudit(db, [
      { occurredAt: at('2031-03-01T09:00:00Z'), actorId, actorLabel: 'a@jbf.org', action: 'content.course.created' },
      { occurredAt: at('2031-03-01T09:05:00Z'), actorId, actorLabel: 'a@jbf.org', action: 'content.lesson.added' },
      { occurredAt: at('2031-03-01T09:10:00Z'), actorId, actorLabel: 'a@jbf.org', action: 'content.lesson.renamed' },
      { occurredAt: at('2031-03-03T14:00:00Z'), actorId, actorLabel: 'a@jbf.org', action: 'content.topic.reordered' },
      { occurredAt: at('2031-03-03T14:30:00Z'), actorId, actorLabel: 'a@jbf.org', action: 'content.topic.deleted' },
      { occurredAt: at('2031-03-03T15:00:00Z'), actorId: null, actorLabel: 'x@evil.test', action: 'auth.login.failed' },
      { occurredAt: at('2031-03-03T15:01:00Z'), actorId: null, actorLabel: 'x@evil.test', action: 'auth.login.failed' },
      { occurredAt: at('2031-03-03T16:00:00Z'), actorId, actorLabel: 'a@jbf.org', action: 'playback.played' },
      // Outside the period: must not be counted.
      { occurredAt: at('2031-02-28T23:59:59Z'), actorId, action: 'content.course.created' },
      { occurredAt: at('2031-03-04T00:00:01Z'), actorId, action: 'content.course.created' },
    ]);

    const res = await request(app.getHttpServer()).get(`/api/audit/analytics${query}`).set(...bearer(admin)).expect(200);
    const body = res.body;

    expect(body.totals).toMatchObject({ events: 8, contentChanges: 5, failedSignIns: 2, securityEvents: 2, activePeople: 1 });
    expect(body.byOperation).toEqual({ created: 2, edited: 1, moved: 1, deleted: 1, restored: 0, purged: 0 });
    expect(body.byCategory).toEqual({ accounts: 2, content: 5, files: 0, playback: 1 });
    expect(body.security.byAction).toEqual([{ action: 'auth.login.failed', label: 'Sign-in failed', count: 2 }]);
    // Three UTC days, the quiet one included as zero.
    expect(body.daily).toEqual([
      { day: '2031-03-01', total: 3, changes: 3, security: 0 },
      { day: '2031-03-02', total: 0, changes: 0, security: 0 },
      { day: '2031-03-03', total: 5, changes: 2, security: 2 },
    ]);
    expect(body.hourly).toHaveLength(24);
    expect(body.hourly[9].total).toBe(3);
    expect(body.topPeople[0]).toMatchObject({ id: actorId, count: 6 });
  });

  it('rejects a period that is backwards, too long or malformed', async () => {
    const get = (q: string) => request(app.getHttpServer()).get(`/api/audit/analytics${q}`).set(...bearer(admin));
    await get(`?from=${encodeURIComponent(TO)}&to=${encodeURIComponent(FROM)}`).expect(400);
    await get(`?from=${encodeURIComponent('2020-01-01T00:00:00Z')}&to=${encodeURIComponent('2031-01-01T00:00:00Z')}`).expect(400);
    await get('?from=yesterday').expect(400);
    await get('').expect(200);
  });

  it('downloads a sectioned CSV report and records the download as an export', async () => {
    const before = await db.$count(auditLog);
    const res = await request(app.getHttpServer()).get(`/api/audit/report.csv${query}`).set(...bearer(admin)).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="audit-report-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(res.text).toContain('Audit activity report');
    expect(res.text).toContain('Content changes by kind');
    expect(res.text).toContain('2031-03-03,');
    expect(await db.$count(auditLog)).toBe(before + 1);

    const log = await request(app.getHttpServer()).get('/api/audit?action=audit.exported&limit=1').set(...bearer(admin)).expect(200);
    expect(log.body.items[0].summary).toMatch(/downloaded the audit activity report/);
  });
});
