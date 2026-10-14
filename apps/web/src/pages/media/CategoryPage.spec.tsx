import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CategorySlug, Folder } from '../../api/media';
import { CATEGORIES } from '../../media/categories';
import type { MockResponse } from '../../test/fetch-mock';
import { makeFolder } from '../../test/folders';
import { mockSession, renderWithSession, STAFF } from '../../test/session';
import { CategoryPage } from './CategoryPage';

const fixture: Folder[] = [
  makeFolder({ id: 'f1', name: 'Safety Training', position: 0, itemCount: 4, sizeBytes: 1_572_864 }),
  makeFolder({ id: 'f2', name: 'Kitchen', position: 1, itemCount: 0 }),
  makeFolder({ id: 'f3', name: '<img src=x onerror=alert(1)>', position: 2, itemCount: 1 }),
];

type Override = MockResponse | ((body: Record<string, unknown>) => MockResponse);

const VIDEOS = CATEGORIES.find((entry) => entry.slug === 'videos')!;
const SONGS = CATEGORIES.find((entry) => entry.slug === 'songs')!;
const PODCASTS = CATEGORIES.find((entry) => entry.slug === 'podcasts')!;

function startServer(overrides: Record<string, Override> = {}, initial: Folder[] = fixture, slug: CategorySlug = 'videos') {
  const base = `/api/media/${slug}/folders`;
  const state = { folders: structuredClone(initial) };
  const calls: { key: string; body: Record<string, unknown> }[] = [];
  mockSession(STAFF, (url, init) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ key, body });
    const override = overrides[key];
    if (override) return typeof override === 'function' ? override(body) : override;
    if (key === `GET ${base}`) return { body: state.folders };
    if (key === `POST ${base}`) {
      const folder = makeFolder({ id: 'f-new', name: String(body.name), position: state.folders.length, category: initial[0]?.category ?? 'video' });
      state.folders.push(folder);
      return { status: 201, body: folder };
    }
    const rename = /^PATCH \/api\/media\/folders\/([^/]+)$/.exec(key);
    if (rename) {
      const folder = state.folders.find((candidate) => candidate.id === rename[1])!;
      folder.name = String(body.name);
      return { body: folder };
    }
    const remove = /^DELETE \/api\/media\/folders\/([^/]+)$/.exec(key);
    if (remove) {
      state.folders = state.folders.filter((folder) => folder.id !== remove[1]);
      return { status: 204, body: null };
    }
    return { status: 404, body: {} };
  });
  return calls;
}

describe('CategoryPage', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('lists the folders with their video counts and an Open link to each', async () => {
    startServer();
    renderWithSession(<CategoryPage category={VIDEOS} />);
    const list = await screen.findByRole('list', { name: 'Video folders' });
    const row = within(list).getAllByRole('listitem')[0] as HTMLElement;
    expect(row).toHaveTextContent('Safety Training');
    expect(row).toHaveTextContent('4 videos');
    expect(within(row).getByRole('link', { name: 'Open Safety Training' })).toHaveAttribute('href', '/videos/f1');
  });

  it('shows hostile folder names as plain text', async () => {
    startServer();
    renderWithSession(<CategoryPage category={VIDEOS} />);
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('shows an empty state with a way forward', async () => {
    startServer({}, []);
    renderWithSession(<CategoryPage category={VIDEOS} />);
    expect(await screen.findByText('No folders yet')).toBeInTheDocument();
    expect(screen.getByText(/create a folder/i)).toBeInTheDocument();
  });

  it('offers Retry when loading fails', async () => {
    let fail = true;
    startServer({ 'GET /api/media/videos/folders': () => (fail ? { status: 500, body: {} } : { body: fixture }) });
    renderWithSession(<CategoryPage category={VIDEOS} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('list', { name: 'Video folders' })).toBeInTheDocument();
  });

  it('creates a folder and shows it', async () => {
    const calls = startServer();
    renderWithSession(<CategoryPage category={VIDEOS} />);
    await userEvent.click(await screen.findByRole('button', { name: 'New folder' }));
    const dialog = screen.getByRole('dialog', { name: 'New folder' });
    await userEvent.type(within(dialog).getByLabelText('Folder name'), '  Orientation ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create folder' }));
    expect(await screen.findByText('Folder "Orientation" created.')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'POST /api/media/videos/folders')?.body).toEqual({ name: 'Orientation' });
    expect(await screen.findByRole('link', { name: 'Open Orientation' })).toBeInTheDocument();
  });

  it('asks for a name before sending anything', async () => {
    const calls = startServer();
    renderWithSession(<CategoryPage category={VIDEOS} />);
    await userEvent.click(await screen.findByRole('button', { name: 'New folder' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create folder' }));
    expect(await screen.findByText('Enter a folder name.')).toBeInTheDocument();
    expect(screen.getByLabelText('Folder name')).toHaveFocus();
    expect(calls.some((call) => call.key.startsWith('POST'))).toBe(false);
  });

  it('keeps the dialog open and explains a name that already exists', async () => {
    startServer({ 'POST /api/media/videos/folders': { status: 409, body: { message: 'A folder with that name already exists.' } } });
    renderWithSession(<CategoryPage category={VIDEOS} />);
    await userEvent.click(await screen.findByRole('button', { name: 'New folder' }));
    await userEvent.type(screen.getByLabelText('Folder name'), 'Kitchen');
    await userEvent.click(screen.getByRole('button', { name: 'Create folder' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    expect(screen.getByRole('dialog', { name: 'New folder' })).toBeInTheDocument();
  });

  it('renames a folder, starting from its current name', async () => {
    const calls = startServer();
    renderWithSession(<CategoryPage category={VIDEOS} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Rename Kitchen' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename folder' });
    const field = within(dialog).getByLabelText('Folder name');
    expect(field).toHaveValue('Kitchen');
    await userEvent.clear(field);
    await userEvent.type(field, 'Canteen');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
    expect(await screen.findByText('Folder renamed to "Canteen".')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'PATCH /api/media/folders/f2')?.body).toEqual({ name: 'Canteen' });
  });

  it('has no way to reorder the folders', async () => {
    startServer();
    renderWithSession(<CategoryPage category={VIDEOS} />);
    await screen.findByRole('list', { name: 'Video folders' });
    expect(screen.queryByRole('button', { name: /^Move / })).not.toBeInTheDocument();
  });

  it('shows what is in each folder: its size, when it was made and last changed, and by whom', async () => {
    const folders = [
      makeFolder({
        id: 'f1',
        name: 'Safety Training',
        itemCount: 4,
        sizeBytes: 1_572_864,
        createdAt: '2026-10-12T09:30:00.000Z',
        createdBy: { id: 'u1', name: 'Anita' },
        updatedAt: '2026-10-13T14:05:00.000Z',
        updatedBy: { id: 'u2', name: 'Ravi' },
      }),
    ];
    startServer({}, folders);
    renderWithSession(<CategoryPage category={VIDEOS} />);
    const row = (await screen.findAllByRole('listitem'))[0] as HTMLElement;
    expect(within(row).getByText('4 videos')).toBeInTheDocument();
    expect(within(row).getByText('1.5 MB')).toBeInTheDocument();
    expect(within(row).getByText('Created').nextSibling).toHaveTextContent(/2026.*by Anita$/);
    expect(within(row).getByText('Updated').nextSibling).toHaveTextContent(/2026.*by Ravi$/);
  });

  it('shows a Songs page with its own words, links and endpoints', async () => {
    const songs: Folder[] = [
      makeFolder({ id: 's1', name: 'Road trip', position: 0, itemCount: 2, category: 'song' }),
      makeFolder({ id: 's2', name: 'Calm', position: 1, itemCount: 0, category: 'song' }),
    ];
    const calls = startServer({}, songs, 'songs');
    renderWithSession(<CategoryPage category={SONGS} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Songs' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Song folders' });
    expect(within(list).getByText('2 songs')).toBeInTheDocument();
    expect(within(list).getByRole('link', { name: 'Open Road trip' })).toHaveAttribute('href', '/songs/s1');
    await userEvent.click(screen.getByRole('button', { name: 'New folder' }));
    await userEvent.type(screen.getByLabelText('Folder name'), 'Party');
    await userEvent.click(screen.getByRole('button', { name: 'Create folder' }));
    expect(await screen.findByText('Folder "Party" created.')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'POST /api/media/songs/folders')?.body).toEqual({ name: 'Party' });
    expect(calls.some((call) => call.key.includes('/videos/'))).toBe(false);
  });

  it('invites the first podcast folder in its own words', async () => {
    startServer({}, [], 'podcasts');
    renderWithSession(<CategoryPage category={PODCASTS} />);
    expect(await screen.findByText('No folders yet')).toBeInTheDocument();
    expect(screen.getByText('Create a folder to start adding podcasts.')).toBeInTheDocument();
  });
  describe('deleting a folder', () => {
    it('has a Delete button on every folder, named after it', async () => {
      startServer();
      renderWithSession(<CategoryPage category={VIDEOS} />);
      expect(await screen.findByRole('button', { name: 'Delete Safety Training' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete Kitchen' })).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /^Delete / })).toHaveLength(3);
    });

    it('asks first, naming what goes with the folder, and sends nothing until it is confirmed', async () => {
      const calls = startServer();
      renderWithSession(<CategoryPage category={VIDEOS} />);
      await userEvent.click(await screen.findByRole('button', { name: 'Delete Safety Training' }));
      const dialog = screen.getByRole('dialog', { name: 'Delete folder' });
      expect(dialog).toHaveTextContent('Delete the folder "Safety Training" for good? Its 4 videos, with their files and covers, are removed too, and this cannot be undone.');
      expect(calls.some((call) => call.key.startsWith('DELETE'))).toBe(false);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(calls.some((call) => call.key.startsWith('DELETE'))).toBe(false);
    });

    it('deletes the folder when confirmed, says so, and takes it off the list', async () => {
      const calls = startServer();
      renderWithSession(<CategoryPage category={VIDEOS} />);
      await userEvent.click(await screen.findByRole('button', { name: 'Delete Kitchen' }));
      const dialog = screen.getByRole('dialog', { name: 'Delete folder' });
      expect(dialog).toHaveTextContent('Delete the folder "Kitchen" for good? This cannot be undone.');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete for good' }));
      expect(await screen.findByText('Folder "Kitchen" deleted.')).toBeInTheDocument();
      expect(calls.some((call) => call.key === 'DELETE /api/media/folders/f2')).toBe(true);
      await waitFor(() => expect(screen.queryByRole('link', { name: 'Open Kitchen' })).toBeNull());
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('says what the server says inside the dialog when the folder cannot go, and keeps it', async () => {
      startServer({ 'DELETE /api/media/folders/f1': { status: 409, body: { message: 'An item in this folder is used in course topics. Remove it from the courses first.' } } });
      renderWithSession(<CategoryPage category={VIDEOS} />);
      await userEvent.click(await screen.findByRole('button', { name: 'Delete Safety Training' }));
      const dialog = screen.getByRole('dialog', { name: 'Delete folder' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete for good' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('used in course topics');
      expect(screen.getByRole('link', { name: 'Open Safety Training' })).toBeInTheDocument();
    });

    it('uses the words of the category', async () => {
      startServer({}, [makeFolder({ id: 's1', name: 'Road trip', itemCount: 1, category: 'song' })], 'songs');
      renderWithSession(<CategoryPage category={SONGS} />);
      await userEvent.click(await screen.findByRole('button', { name: 'Delete Road trip' }));
      expect(screen.getByRole('dialog', { name: 'Delete folder' })).toHaveTextContent('Its 1 song, with its file and cover, is removed too');
    });
  });
});
