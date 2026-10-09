import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Folder, VideoItem } from '../../api/media';
import type { MockResponse } from '../../test/fetch-mock';
import { mockSession, renderWithSession, STAFF } from '../../test/session';
import { FolderPage } from './FolderPage';

const folder: Folder = { id: 'f1', name: 'Safety Training', position: 0, itemCount: 3 };
const item = (overrides: Partial<VideoItem> & { id: string; title: string }): VideoItem => ({
  folderId: 'f1',
  description: null,
  durationSeconds: 724,
  sizeBytes: 412 * 1024 ** 2,
  status: 'ready',
  coverUrl: null,
  createdBy: { id: 'u1', name: 'Anita Rao' },
  createdAt: '2026-10-08T10:00:00Z',
  position: 0,
  ...overrides,
});
const fixture: VideoItem[] = [
  item({ id: 'v1', title: 'Fire exits', description: 'Where to go.', coverUrl: 'https://cdn.example/c1?sig=1' }),
  item({ id: 'v2', title: 'First aid basics', durationSeconds: null, sizeBytes: 280 * 1024 ** 2, position: 1 }),
  item({ id: 'v3', title: '<b>Kitchen</b> hygiene', position: 2, status: 'uploading', createdBy: { id: 'staff-1', name: 'Ben Okoye' } }),
];

type Override = MockResponse | ((body: Record<string, unknown>) => MockResponse);

function startServer(overrides: Record<string, Override> = {}, items: VideoItem[] = fixture, folders: Folder[] = [folder]) {
  const state = { items: structuredClone(items) };
  const calls: { key: string; body: Record<string, unknown> }[] = [];
  mockSession(STAFF, (url, init) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ key, body });
    const override = overrides[key];
    if (override) return typeof override === 'function' ? override(body) : override;
    if (key === 'GET /api/media/videos/folders') return { body: folders };
    if (key === 'GET /api/media/folders/f1/items') return { body: state.items };
    const edit = /^PATCH \/api\/media\/items\/([^/]+)$/.exec(key);
    if (edit) {
      const target = state.items.find((candidate) => candidate.id === edit[1])!;
      Object.assign(target, body);
      return { body: target };
    }
    if (key === 'PUT /api/media/folders/f1/items/order') {
      const ids = body.ids as string[];
      const ready = ids.map((id) => state.items.find((candidate) => candidate.id === id)!);
      state.items = [...ready, ...state.items.filter((candidate) => !ids.includes(candidate.id))];
      return { body: state.items };
    }
    if (key === 'POST /api/media/items/v1/play') {
      return { body: { url: 'https://cdn.example/video-1?sig=1', expiresAt: '2026-10-08T11:00:00Z', contentType: 'video/mp4' } };
    }
    return { status: 404, body: {} };
  });
  return calls;
}

function renderPage(route = '/videos/f1') {
  return renderWithSession(
    <Routes>
      <Route path="/videos/:folderId" element={<FolderPage />} />
    </Routes>,
    route,
  );
}

function renderPageInStrictMode() {
  return renderWithSession(
    <StrictMode>
      <Routes>
        <Route path="/videos/:folderId" element={<FolderPage />} />
      </Routes>
    </StrictMode>,
    '/videos/f1',
  );
}

describe('FolderPage', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('shows the folder name, a way back, and the videos with length, size, adder and date', async () => {
    startServer();
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Safety Training' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Videos');
    expect(screen.getByRole('link', { name: 'Videos' })).toHaveAttribute('href', '/videos');
    const row = screen.getByRole('row', { name: /Fire exits/ });
    expect(within(row).getByText('12:04')).toBeInTheDocument();
    expect(within(row).getByText('412 MB')).toBeInTheDocument();
    expect(within(row).getByText(/Anita Rao/)).toBeInTheDocument();
  });

  it('shows a cover picture where there is one and a placeholder where there is not', async () => {
    startServer();
    renderPage();
    await screen.findByRole('heading', { name: 'Safety Training' });
    const pictures = document.querySelectorAll('img');
    expect(pictures).toHaveLength(1);
    expect(pictures[0]).toHaveAttribute('src', 'https://cdn.example/c1?sig=1');
    expect(pictures[0]).toHaveAttribute('alt', '');
  });

  it('shows your uploading video with a badge, no actions, and hostile text as plain text', async () => {
    startServer();
    renderPage();
    const row = (await screen.findByText('<b>Kitchen</b> hygiene')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Uploading')).toBeInTheDocument();
    expect(within(row).queryByRole('button')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
  });

  it('says so when the folder is empty, and when it does not exist', async () => {
    startServer({}, []);
    const first = renderPage();
    expect(await screen.findByText('No videos in this folder yet')).toBeInTheDocument();
    first.unmount();

    startServer({ 'GET /api/media/folders/f1/items': { status: 404, body: { message: 'Folder not found.' } } });
    renderPage();
    expect(await screen.findByText('Folder not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Videos' })).toHaveAttribute('href', '/videos');
  });

  it('offers Retry when loading fails', async () => {
    let fail = true;
    startServer({ 'GET /api/media/folders/f1/items': () => (fail ? { status: 500, body: {} } : { body: fixture }) });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Safety Training' })).toBeInTheDocument();
  });

  it('opens the player from the title or from the row, and asks for a playback link once', async () => {
    const calls = startServer();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Fire exits' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fire exits' });
    await waitFor(() => expect(dialog.querySelector('video')).toHaveAttribute('src', 'https://cdn.example/video-1?sig=1'));
    expect(within(dialog).getByText('Where to go.')).toBeInTheDocument();
    expect(calls.filter((call) => call.key === 'POST /api/media/items/v1/play')).toHaveLength(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(document.querySelector('video')).toBeNull());

    await userEvent.click(screen.getByText('12:04'));
    expect(await screen.findByRole('dialog', { name: 'Fire exits' })).toBeInTheDocument();
  });

  it('edits the title and description and shows the result', async () => {
    const calls = startServer();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Fire exits' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit video' });
    const title = within(dialog).getByLabelText('Title');
    expect(title).toHaveValue('Fire exits');
    await userEvent.clear(title);
    await userEvent.type(title, 'Fire exits and drills');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('button', { name: 'Fire exits and drills' })).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'PATCH /api/media/items/v1')?.body).toEqual({ title: 'Fire exits and drills' });
  });

  it('refuses an empty title and an unsuitable cover without calling the server', async () => {
    const calls = startServer();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Fire exits' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit video' });
    await userEvent.clear(within(dialog).getByLabelText('Title'));
    await userEvent.upload(within(dialog).getByLabelText('Cover image'), new File(['x'], 'cover.gif', { type: 'image/gif' }), { applyAccept: false });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Enter a title.')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose a JPEG, PNG or WebP image.')).toBeInTheDocument();
    expect(calls.some((call) => call.key.startsWith('PATCH') || call.key.includes('/cover'))).toBe(false);
  });

  it('shows a server refusal inside the dialog and keeps it open', async () => {
    startServer({ 'PATCH /api/media/items/v1': { status: 400, body: { message: 'Validation failed', fieldErrors: { title: ['Title must be 200 characters or fewer.'] } } } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Fire exits' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit video' });
    await userEvent.type(within(dialog).getByLabelText('Title'), ' more');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Title must be 200 characters or fewer.')).toBeInTheDocument();
  });

  it('moves a ready video down and sends only the ready videos, disabling impossible moves', async () => {
    const calls = startServer();
    renderPage();
    await screen.findByRole('heading', { name: 'Safety Training' });
    expect(screen.getByRole('button', { name: 'Move Fire exits up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move First aid basics down' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move Fire exits down' }));
    await waitFor(() => expect(calls.find((call) => call.key === 'PUT /api/media/folders/f1/items/order')?.body).toEqual({ ids: ['v2', 'v1'] }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move Fire exits up' })).not.toBeDisabled());
  });

  it('reloads and explains when the order changed under you', async () => {
    startServer({ 'PUT /api/media/folders/f1/items/order': { status: 409, body: { message: 'The list changed while you were editing it. Reload and try again.' } } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Move Fire exits down' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The list changed');
  });

  it('asks once for a fresh link when the video stops loading, then gives up with a message', async () => {
    let plays = 0;
    startServer({
      'POST /api/media/items/v1/play': () => {
        plays += 1;
        return { body: { url: `https://cdn.example/video-${plays}?sig=1`, expiresAt: '2026-10-08T11:00:00Z', contentType: 'video/mp4' } };
      },
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Fire exits' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fire exits' });
    await waitFor(() => expect(dialog.querySelector('video')).toHaveAttribute('src', 'https://cdn.example/video-1?sig=1'));
    fireEvent.error(dialog.querySelector('video') as HTMLVideoElement);
    await waitFor(() => expect(dialog.querySelector('video')).toHaveAttribute('src', 'https://cdn.example/video-2?sig=1'));
    fireEvent.error(dialog.querySelector('video') as HTMLVideoElement);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('could not be played');
    expect(plays).toBe(2);
  });

  it('asks for a playback link only once even when effects run twice (development double-run)', async () => {
    const calls = startServer();
    renderPageInStrictMode();
    await userEvent.click(await screen.findByRole('button', { name: 'Fire exits' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fire exits' });
    await waitFor(() => expect(dialog.querySelector('video')).toHaveAttribute('src', 'https://cdn.example/video-1?sig=1'));
    expect(calls.filter((call) => call.key === 'POST /api/media/items/v1/play')).toHaveLength(1);
  });
});
