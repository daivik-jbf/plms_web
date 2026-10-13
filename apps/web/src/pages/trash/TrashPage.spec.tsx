import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrashEntry } from '../../api/trash';
import type { MockResponse } from '../../test/fetch-mock';
import { ADMIN, mockSession, renderWithSession } from '../../test/session';
import { TrashPage } from './TrashPage';

const entry = (overrides: Partial<TrashEntry> & { id: string; title: string; type: TrashEntry['type'] }): TrashEntry => ({
  deletedAt: '2026-10-12T10:00:00Z',
  deletedBy: { id: 'a1', name: 'Anita Rao' },
  courseTitle: null,
  lessonTitle: null,
  lessonCount: null,
  topicCount: null,
  ...overrides,
});

const fixture: TrashEntry[] = [
  entry({ id: 'c1', type: 'course', title: 'Fire safety', lessonCount: 3, topicCount: 7 }),
  entry({ id: 'l1', type: 'lesson', title: 'Exits', courseTitle: 'First aid', topicCount: 1 }),
  entry({ id: 't1', type: 'topic', title: '<b>Alarms</b>', lessonTitle: 'Bells', courseTitle: 'First aid' }),
  entry({ id: 'a1', type: 'attachment', title: 'Exit map', topicTitle: 'Types', lessonTitle: 'Bells', courseTitle: 'First aid' }),
];

type Override = MockResponse | (() => MockResponse);

function startServer(overrides: Record<string, Override> = {}, initial: TrashEntry[] = fixture) {
  const state = { entries: structuredClone(initial) };
  const calls: string[] = [];
  mockSession(ADMIN, (url, init) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    calls.push(key);
    const override = overrides[key];
    if (override) return typeof override === 'function' ? override() : override;
    if (key === 'GET /api/trash') return { body: state.entries };
    const act = /^(POST|DELETE) \/api\/trash\/(course|lesson|topic|attachment)\/([^/]+)(\/restore)?$/.exec(key);
    if (act) {
      state.entries = state.entries.filter((candidate) => candidate.id !== act[3]);
      return { status: 204, body: null };
    }
    return { status: 404, body: {} };
  });
  return calls;
}

describe('TrashPage', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('lists what was deleted with where it was, what it holds, and who deleted it', async () => {
    startServer();
    renderWithSession(<TrashPage />);
    const table = await screen.findByRole('table', { name: 'Trash' });
    const course = within(table).getByRole('row', { name: /Fire safety/ });
    expect(course).toHaveTextContent('Course');
    expect(course).toHaveTextContent('3 lessons, 7 topics');
    expect(course).toHaveTextContent('by Anita Rao');
    expect(within(table).getByRole('row', { name: /Exits/ })).toHaveTextContent('In the course "First aid"');
    expect(within(table).getByRole('row', { name: /Exits/ })).toHaveTextContent('1 topic');
    expect(within(table).getByRole('row', { name: /Alarms/ })).toHaveTextContent('In the lesson "Bells", course "First aid"');
  });

  it('lists a deleted file with the topic, lesson and course it was in', async () => {
    startServer();
    renderWithSession(<TrashPage />);
    const row = within(await screen.findByRole('table', { name: 'Trash' })).getByRole('row', { name: /Exit map/ });
    expect(row).toHaveTextContent('Attachment');
    expect(row).toHaveTextContent('In the topic "Types", lesson "Bells", course "First aid"');
  });

  it('shows hostile titles as plain text', async () => {
    startServer();
    renderWithSession(<TrashPage />);
    expect(await screen.findByText('<b>Alarms</b>')).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
  });

  it('says when the Trash is empty', async () => {
    startServer({}, []);
    renderWithSession(<TrashPage />);
    expect(await screen.findByText('The Trash is empty')).toBeInTheDocument();
  });

  it('shows a loading state, then offers Retry when loading fails', async () => {
    let fail = true;
    startServer({ 'GET /api/trash': () => (fail ? { status: 500, body: {} } : { body: fixture }) });
    renderWithSession(<TrashPage />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table', { name: 'Trash' })).toBeInTheDocument();
  });

  it('restores an item at once and takes it off the list', async () => {
    const calls = startServer();
    renderWithSession(<TrashPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Restore Exits' }));
    expect(await screen.findByText('Lesson "Exits" restored.')).toBeInTheDocument();
    expect(calls).toContain('POST /api/trash/lesson/l1/restore');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Restore Exits' })).toBeNull());
  });

  it('says why an item cannot be restored yet', async () => {
    startServer({ 'POST /api/trash/topic/t1/restore': { status: 409, body: { message: 'Restore the lesson "Bells" first.' } } });
    renderWithSession(<TrashPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Restore <b>Alarms</b>' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Restore the lesson "Bells" first.');
    expect(screen.getByRole('button', { name: 'Restore <b>Alarms</b>' })).toBeInTheDocument();
  });

  it('asks before deleting for good, and then removes the item', async () => {
    const calls = startServer();
    renderWithSession(<TrashPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Fire safety for good' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete for good' });
    expect(dialog).toHaveTextContent('Delete the course "Fire safety" for good?');
    expect(dialog).toHaveTextContent('cannot be restored');
    expect(calls.some((call) => call.startsWith('DELETE'))).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete for good' }));
    expect(await screen.findByText('Course "Fire safety" deleted for good.')).toBeInTheDocument();
    expect(calls).toContain('DELETE /api/trash/course/c1');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete Fire safety for good' })).toBeNull());
  });

  it('can be called off, and removes nothing', async () => {
    const calls = startServer();
    renderWithSession(<TrashPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Exits for good' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete for good' })).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.some((call) => call.startsWith('DELETE'))).toBe(false);
  });

  it('shows what the server says inside the dialog and keeps it open', async () => {
    startServer({ 'DELETE /api/trash/course/c1': { status: 404, body: { message: 'That is not in the Trash.' } } });
    renderWithSession(<TrashPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Fire safety for good' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete for good' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete for good' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That is not in the Trash.');
  });
});
