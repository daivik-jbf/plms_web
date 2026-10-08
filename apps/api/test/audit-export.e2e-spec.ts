import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, desc, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import { auditLog, type User } from '../src/db/schema';
import { bearer, loginMobile, type Session } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { seedAudit } from './helpers/audit';
import { parseCsv } from './helpers/csv';
import { createUser } from './helpers/users';

describe('audit export and page-opened marker', () => {
  let app: NestExpressApplication;
  let db: Database;
  let adminUser: User;
  let admin: Session;
  let staff: Session;

  beforeAll(async () => {
    process.env.AUDIT_EXPORT_MAX_ROWS = '5';
    ({ app, db } = await createTestApp());
    adminUser = await createUser(db, { role: 'admin', name: 'Anita Rao' });
    admin = await loginMobile(app, adminUser.email);
    staff = await loginMobile(app, (await createUser(db, { role: 'staff' })).email);
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const exportAs = (session: Session, query: string) =>
    http()
      .get(`/api/audit/export.csv?${query}`)
      .set(...bearer(session))
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (data += chunk));
        res.on('end', () => callback(null, data));
      });
  const exportCsv = (query: string) => exportAs(admin, query);

  it('is Admin-only for both endpoints', async () => {
    await http().post('/api/audit/opened').expect(401);
    await http().post('/api/audit/opened').set(...bearer(staff)).expect(403);
    await http().get('/api/audit/export.csv').expect(401);
    await http().get('/api/audit/export.csv').set(...bearer(staff)).expect(403);
  });

  describe('POST /api/audit/opened', () => {
    it('records one audit.viewed entry per call for the signed-in Admin', async () => {
      const before = await db.select().from(auditLog).where(and(eq(auditLog.actorId, adminUser.id), eq(auditLog.action, 'audit.viewed')));
      await http().post('/api/audit/opened').set(...bearer(admin)).expect(204);
      const after = await db.select().from(auditLog).where(and(eq(auditLog.actorId, adminUser.id), eq(auditLog.action, 'audit.viewed')));
      expect(after.length).toBe(before.length + 1);
      expect(after.at(-1)).toMatchObject({ actorRole: 'admin', actorLabel: adminUser.email });
    });
  });

  describe('GET /api/audit/export.csv', () => {
    it('streams a UTF-8 CSV with a BOM, a header row and the filtered rows newest first', async () => {
      const actorId = randomUUID();
      await seedAudit(db, [
        { actorId, actorRole: 'staff', actorLabel: 'a@example.com', action: 'auth.logout', occurredAt: new Date('2026-04-01T10:00:00Z') },
        { actorId, actorRole: 'staff', actorLabel: 'a@example.com', action: 'auth.login.succeeded', occurredAt: new Date('2026-04-01T09:00:00Z') },
      ]);
      const res = await exportCsv(`actorId=${actorId}`).expect(200);
      expect(res.headers['content-type']).toMatch(/^text\/csv/);
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="audit-log-\d{4}-\d{2}-\d{2}\.csv"$/);
      expect((res.body as string).charCodeAt(0)).toBe(0xfeff);
      const rows = parseCsv(res.body);
      expect(rows[0]).toEqual([
        'Time (UTC)', 'Person', 'Role', 'Action', 'Label', 'Target type', 'Target', 'Source', 'IP', 'App version', 'Request id', 'Summary', 'Changes',
      ]);
      expect(rows).toHaveLength(3);
      expect(rows[1]![0]).toBe('2026-04-01T10:00:00.000Z');
      expect(rows[1]![3]).toBe('auth.logout');
      expect(rows[1]![11]).toBe('a@example.com signed out');
      expect(rows[2]![3]).toBe('auth.login.succeeded');
    });

    it('neutralizes spreadsheet formulas and quotes awkward text', async () => {
      const actorId = randomUUID();
      const labels = ['=HYPERLINK("http://evil")', '+1+1', '@SUM(1)', 'comma, "quote"\nnewline'];
      await seedAudit(
        db,
        labels.map((label, index) => ({
          actorId,
          actorLabel: label,
          action: 'auth.login.failed',
          occurredAt: new Date(Date.UTC(2026, 4, 1, 10, index)),
        })),
      );
      const rows = parseCsv((await exportCsv(`actorId=${actorId}`).expect(200)).body);
      const people = rows.slice(1).map((row) => row[1]);
      expect(people).toEqual(["comma, \"quote\"\nnewline", "'@SUM(1)", "'+1+1", "'=HYPERLINK(\"http://evil\")"]);
    });

    it('exports a header-only file when nothing matches', async () => {
      const rows = parseCsv((await exportCsv(`actorId=${randomUUID()}`).expect(200)).body);
      expect(rows).toHaveLength(1);
    });

    it('allows exactly the cap and refuses cap + 1 with a clear 413', async () => {
      const exactly = randomUUID();
      await seedAudit(db, Array.from({ length: 5 }, () => ({ actorId: exactly })));
      expect(parseCsv((await exportCsv(`actorId=${exactly}`).expect(200)).body)).toHaveLength(6);

      const tooMany = randomUUID();
      await seedAudit(db, Array.from({ length: 6 }, () => ({ actorId: tooMany })));
      const res = await http().get(`/api/audit/export.csv?actorId=${tooMany}`).set(...bearer(admin)).expect(413);
      expect(res.body.message).toBe('Too many rows to export (limit 5). Narrow the filters.');
      expect(res.body.requestId).toBeDefined();
    });

    it('records audit.exported with the filters and row count but never the exported data', async () => {
      const actorId = randomUUID();
      const secretLabel = `secret-label-${randomUUID()}`;
      await seedAudit(db, [{ actorId, actorLabel: secretLabel }, { actorId, actorLabel: secretLabel }]);
      await exportCsv(`actorId=${actorId}`).expect(200);
      const [entry] = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.actorId, adminUser.id), eq(auditLog.action, 'audit.exported')))
        .orderBy(desc(auditLog.occurredAt))
        .limit(1);
      expect(entry!.metadata).toMatchObject({ rowCount: 2, filters: { actorId } });
      expect(JSON.stringify(entry)).not.toContain(secretLabel);
    });

    describe('snapshot consistency', () => {
      const dataRows = (rows: string[][]) => rows.slice(1);
      const newestExport = async (actorId: string) =>
        (
          await db
            .select()
            .from(auditLog)
            .where(and(eq(auditLog.actorId, actorId), eq(auditLog.action, 'audit.exported')))
            .orderBy(desc(auditLog.occurredAt))
            .limit(1)
        )[0]!;

      it('exports exactly the rows it counted: the audit.exported entry it records is not in its own file', async () => {
        const own = await createUser(db, { role: 'admin' });
        const ownSession = await loginMobile(app, own.email);
        await seedAudit(db, [
          { actorId: own.id, occurredAt: new Date('2026-03-01T10:00:00Z') },
          { actorId: own.id, occurredAt: new Date('2026-03-01T09:00:00Z') },
        ]);
        const exportedRows = (rows: string[][]) => dataRows(rows).filter((row) => row[3] === 'audit.exported').length;

        const first = parseCsv((await exportAs(ownSession, `actorId=${own.id}`).expect(200)).body);
        expect(dataRows(first)).toHaveLength(((await newestExport(own.id)).metadata as { rowCount: number }).rowCount);
        expect(exportedRows(first)).toBe(0);

        const second = parseCsv((await exportAs(ownSession, `actorId=${own.id}`).expect(200)).body);
        const entry = await newestExport(own.id);
        expect(entry.metadata).toMatchObject({ filters: { actorId: own.id } });
        expect(dataRows(second)).toHaveLength((entry.metadata as { rowCount: number }).rowCount);
        // Only the first export's entry is in the second file, not the second export's own entry.
        expect(exportedRows(second)).toBe(1);
        expect(dataRows(second)).toHaveLength(dataRows(first).length + 1);
      });

      it('exports exactly the cap when the filter would also match the audit entry of the export itself', async () => {
        const own = await createUser(db, { role: 'admin' });
        const ownSession = await loginMobile(app, own.email);
        await seedAudit(
          db,
          Array.from({ length: 5 }, (_, index) => ({
            actorId: own.id,
            action: 'audit.exported',
            occurredAt: new Date(Date.UTC(2026, 2, 2, 10, index)),
          })),
        );
        const query = `actorId=${own.id}&action=audit.exported`;
        const file = await exportAs(ownSession, query).expect(200);
        expect(dataRows(parseCsv(file.body))).toHaveLength(5);
        expect((await newestExport(own.id)).metadata).toMatchObject({ rowCount: 5 });

        // The first export's own entry now matches the filter (6 rows), so an unbounded repeat is honestly over the cap...
        await http().get(`/api/audit/export.csv?${query}`).set(...bearer(ownSession)).expect(413);
        // ...while a repeat bounded to the original five rows still exports exactly the cap.
        const bounded = await exportAs(ownSession, `${query}&to=2026-03-03T00:00:00Z`).expect(200);
        expect(dataRows(parseCsv(bounded.body))).toHaveLength(5);
      });
    });

    it('rejects invalid filters before streaming anything', async () => {
      const res = await http().get('/api/audit/export.csv?actorId=nope').set(...bearer(admin)).expect(400);
      expect(res.body.fieldErrors.actorId).toBeDefined();
    });
  });
});
