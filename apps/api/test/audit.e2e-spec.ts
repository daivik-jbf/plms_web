import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { Database } from '../src/db/db.module';
import type { User } from '../src/db/schema';
import { bearer, loginMobile, type Session } from './helpers/auth';
import { createTestApp } from './helpers/app';
import { seedAudit, seedAuditAt } from './helpers/audit';
import { createUser } from './helpers/users';

describe('GET /api/audit', () => {
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

  const get = (query = '') => request(app.getHttpServer()).get(`/api/audit${query}`).set(...bearer(admin));
  const ids = (body: { items: { id: string }[] }) => body.items.map((item) => item.id);

  it('is Admin-only', async () => {
    await request(app.getHttpServer()).get('/api/audit').expect(401);
    await request(app.getHttpServer()).get('/api/audit').set(...bearer(staff)).expect(403);
  });

  describe('paging', () => {
    it('returns every row exactly once, in a stable newest-first order, across identical and microsecond-different timestamps', async () => {
      const actorId = randomUUID();
      const stamps = [
        '2026-01-01 10:00:00.000300+00',
        '2026-01-01 10:00:00.000300+00',
        '2026-01-01 10:00:00.000200+00',
        '2026-01-01 10:00:00.000100+00',
        '2026-01-01 09:59:59+00',
        '2026-01-01 09:59:59+00',
        '2026-01-01 09:00:00+00',
      ];
      const seeded: string[] = [];
      for (const stamp of stamps) seeded.push(await seedAuditAt(db, stamp, { actorId }));

      const all = await get(`?actorId=${actorId}&limit=100`).expect(200);
      expect(all.body.nextCursor).toBeNull();
      const expectedOrder = ids(all.body);
      expect(new Set(expectedOrder)).toEqual(new Set(seeded));

      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const res = await get(`?actorId=${actorId}&limit=3${cursor ? `&cursor=${cursor}` : ''}`).expect(200);
        seen.push(...ids(res.body));
        cursor = res.body.nextCursor ?? undefined;
        pages += 1;
      } while (cursor);

      expect(pages).toBe(3);
      expect(seen).toEqual(expectedOrder);
      expect(new Set(seen).size).toBe(7);

      // One row per page forces every page boundary, including those inside tied timestamps, to rely on the id tie-break.
      const singles: string[] = [];
      let singleCursor: string | undefined;
      let singlePages = 0;
      do {
        const res = await get(`?actorId=${actorId}&limit=1${singleCursor ? `&cursor=${singleCursor}` : ''}`).expect(200);
        singles.push(...ids(res.body));
        singleCursor = res.body.nextCursor ?? undefined;
        singlePages += 1;
      } while (singleCursor);

      expect(singlePages).toBe(7);
      expect(singles).toEqual(expectedOrder);
      expect(new Set(singles).size).toBe(7);
    });

    it('is not disturbed by newer rows arriving between pages', async () => {
      const actorId = randomUUID();
      for (const stamp of ['2026-02-01 10:00:05+00', '2026-02-01 10:00:04+00', '2026-02-01 10:00:03+00', '2026-02-01 10:00:02+00']) {
        await seedAuditAt(db, stamp, { actorId });
      }
      const first = await get(`?actorId=${actorId}&limit=2`).expect(200);
      const secondBefore = await get(`?actorId=${actorId}&limit=2&cursor=${first.body.nextCursor}`).expect(200);

      await seedAuditAt(db, '2026-02-01 10:00:09+00', { actorId });
      const secondAfter = await get(`?actorId=${actorId}&limit=2&cursor=${first.body.nextCursor}`).expect(200);
      expect(ids(secondAfter.body)).toEqual(ids(secondBefore.body));
    });

    it('rejects well-formed but impossible cursor timestamps with a 400, not a 500', async () => {
      for (const t of ['2026-13-45 99:99:99+00', '2026-02-30 00:00:00+00', '2026-10-08 24:00:00+00', '2026-10-08 10:42:60+00']) {
        const cursor = Buffer.from(JSON.stringify({ t, id: randomUUID() })).toString('base64url');
        const res = await get(`?cursor=${cursor}`).expect(400);
        expect(res.body.fieldErrors.cursor).toBeDefined();
      }
    });

    it('defaults to 50 per page and rejects out-of-range limits', async () => {
      const res = await get().expect(200);
      expect(res.body.items.length).toBeLessThanOrEqual(50);
      for (const limit of ['0', '101', 'abc']) {
        const bad = await get(`?limit=${limit}`).expect(400);
        expect(bad.body.fieldErrors.limit).toBeDefined();
      }
    });
  });

  describe('filters', () => {
    it('filters by actor and by involving (performed by OR done to)', async () => {
      const person = randomUUID();
      const other = randomUUID();
      const [byPerson, toPerson, unrelated] = await seedAudit(db, [
        { actorId: person, action: 'user.deactivated', targetType: 'user', targetId: other },
        { actorId: other, action: 'user.reactivated', targetType: 'user', targetId: person },
        { actorId: other, action: 'user.role_changed', targetType: 'user', targetId: other },
      ]);
      expect(ids((await get(`?actorId=${person}`).expect(200)).body)).toEqual([byPerson]);
      expect(new Set(ids((await get(`?involving=${person}`).expect(200)).body))).toEqual(new Set([byPerson, toPerson]));
      expect(ids((await get(`?involving=${person}`).expect(200)).body)).not.toContain(unrelated);
    });

    it('does not treat an invite target id as a user target for involving', async () => {
      const id = randomUUID();
      await seedAudit(db, [{ actorId: randomUUID(), action: 'invite.created', targetType: 'invite', targetId: id }]);
      expect((await get(`?involving=${id}`).expect(200)).body.items).toEqual([]);
    });

    it('filters by category and action', async () => {
      const actorId = randomUUID();
      const [account, content, file] = await seedAudit(db, [
        { actorId, action: 'auth.logout' },
        { actorId, action: 'content.created' },
        { actorId, action: 'file.uploaded' },
      ]);
      expect(ids((await get(`?actorId=${actorId}&category=accounts`).expect(200)).body)).toEqual([account]);
      expect(ids((await get(`?actorId=${actorId}&category=content`).expect(200)).body)).toEqual([content]);
      expect(ids((await get(`?actorId=${actorId}&category=files`).expect(200)).body)).toEqual([file]);
      expect(ids((await get(`?actorId=${actorId}&action=auth.logout`).expect(200)).body)).toEqual([account]);
    });

    it('hides playback by default ("Changes only") and shows it with includePlayback or category=playback', async () => {
      const actorId = randomUUID();
      const [signIn, played, downloaded] = await seedAudit(db, [
        { actorId, action: 'auth.login.succeeded' },
        { actorId, action: 'playback.played' },
        { actorId, action: 'download.completed' },
      ]);
      expect(ids((await get(`?actorId=${actorId}`).expect(200)).body)).toEqual([signIn]);
      expect(new Set(ids((await get(`?actorId=${actorId}&includePlayback=true`).expect(200)).body))).toEqual(
        new Set([signIn, played, downloaded]),
      );
      expect(new Set(ids((await get(`?actorId=${actorId}&category=playback`).expect(200)).body))).toEqual(
        new Set([played, downloaded]),
      );
    });

    it('filters by date range (inclusive)', async () => {
      const actorId = randomUUID();
      await seedAuditAt(db, '2026-03-01 08:00:00+00', { actorId });
      const middle = await seedAuditAt(db, '2026-03-02 12:00:00+00', { actorId });
      await seedAuditAt(db, '2026-03-03 18:00:00+00', { actorId });
      const res = await get(`?actorId=${actorId}&from=2026-03-02T00:00:00.000Z&to=2026-03-02T23:59:59.999Z`).expect(200);
      expect(ids(res.body)).toEqual([middle]);
    });

    it('searches labels, action and names case-insensitively, and treats % and _ literally', async () => {
      const tag = randomUUID();
      const named = await createUser(db, { name: `Zelda ${tag.slice(0, 8)}` });
      const [byLabel, byName, percent, plain] = await seedAudit(db, [
        { actorLabel: `needle-${tag}@example.com` },
        { actorId: named.id, actorLabel: named.email },
        { actorLabel: `100%-${tag}` },
        { actorLabel: `100x-${tag}` },
      ]);
      expect(ids((await get(`?q=NEEDLE-${tag}`).expect(200)).body)).toEqual([byLabel]);
      expect(ids((await get(`?q=zelda ${tag.slice(0, 8)}`).expect(200)).body)).toEqual([byName]);
      expect(ids((await get(`?q=${encodeURIComponent(`100%-${tag}`)}`).expect(200)).body)).toEqual([percent]);
      expect(ids((await get(`?q=${encodeURIComponent(`100_-${tag}`)}`).expect(200)).body)).toEqual([]);
      expect(plain).toBeDefined();
    });

    it('rejects invalid filter values with field errors', async () => {
      const cases: [string, string][] = [
        ['actorId=nope', 'actorId'],
        ['involving=nope', 'involving'],
        ['category=other', 'category'],
        ['action=made.up', 'action'],
        ['from=yesterday', 'from'],
        ['to=tomorrow', 'to'],
        ['cursor=garbage', 'cursor'],
        [`q=${'x'.repeat(101)}`, 'q'],
        ['includePlayback=maybe', 'includePlayback'],
      ];
      for (const [query, field] of cases) {
        const res = await get(`?${query}`).expect(400);
        expect(res.body.fieldErrors[field]).toBeDefined();
      }
    });
  });

  describe('entries', () => {
    it('presents people by name with the plain-English summary, tone, label and category', async () => {
      const target = await createUser(db, { name: 'Ben Okoye' });
      const [rowId] = await seedAudit(db, [
        {
          actorId: adminUser.id,
          actorRole: 'admin',
          actorLabel: adminUser.email,
          action: 'user.role_changed',
          targetType: 'user',
          targetId: target.id,
          targetLabel: target.email,
          changes: { role: { before: 'staff', after: 'admin' } },
          source: 'portal',
        },
      ]);
      const res = await get(`?involving=${target.id}`).expect(200);
      const entry = res.body.items.find((item: { id: string }) => item.id === rowId);
      expect(entry).toMatchObject({
        action: 'user.role_changed',
        label: 'Role changed',
        tone: 'change',
        category: 'accounts',
        summary: "Anita Rao changed Ben Okoye's role from Staff to Admin",
        actor: { id: adminUser.id, role: 'admin', label: adminUser.email, name: 'Anita Rao' },
        target: { type: 'user', id: target.id, label: target.email, name: 'Ben Okoye' },
        changes: { role: { before: 'staff', after: 'admin' } },
      });
    });

    it('returns the full record fields and a null actor/target when there are none', async () => {
      const marker = randomUUID();
      await seedAudit(db, [{ actorLabel: null, actorId: null, action: 'auth.logout', metadata: { marker } }]);
      const res = await get('?q=auth.logout&limit=100').expect(200);
      const entry = res.body.items.find((item: { metadata: { marker?: string } | null }) => item.metadata?.marker === marker);
      expect(entry.actor).toBeNull();
      expect(entry.target).toBeNull();
      expect(Object.keys(entry).sort()).toEqual(
        [
          'action', 'actor', 'appVersion', 'category', 'changes', 'id', 'ip', 'label', 'metadata', 'occurredAt',
          'requestId', 'source', 'summary', 'target', 'tone', 'userAgent',
        ].sort(),
      );
    });

    it('shows the typed label for failed sign-ins of unknown emails', async () => {
      const label = `ghost-${randomUUID()}@example.com`;
      await seedAudit(db, [{ actorLabel: label, action: 'auth.login.failed', metadata: { reason: 'unknown_email' } }]);
      const res = await get(`?q=${label}`).expect(200);
      expect(res.body.items[0]).toMatchObject({
        tone: 'warning',
        summary: `Failed sign-in for ${label} (no account with that email)`,
      });
    });
  });
});
