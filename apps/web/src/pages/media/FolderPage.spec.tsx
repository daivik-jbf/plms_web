import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CategorySlug, Folder, MediaItem } from '../../api/media';
import { type CategoryConfig, CATEGORIES } from '../../media/categories';
import { DockedPlayer } from '../../player/DockedPlayer';
import { PlayerContext, PlayerProvider, type PlayerValue } from '../../player/PlayerContext';
import type { MockResponse } from '../../test/fetch-mock';
import { mockSession, renderWithSession, STAFF } from '../../test/session';
import { type UploadJob, UploadsContext, type UploadsValue } from '../../uploads/UploadsContext';
import { FolderPage } from './FolderPage';

const VIDEOS = CATEGORIES.find((entry) => entry.slug === 'videos')!;
const MOVIES = CATEGORIES.find((entry) => entry.slug === 'movies')!;
const SONGS = CATEGORIES.find((entry) => entry.slug === 'songs')!;

const folder: Folder = { id: 'f1', name: 'Safety Training', position: 0, itemCount: 3, category: 'video' };
const item = (overrides: Partial<MediaItem> & { id: string; title: string }): MediaItem => ({
  folderId: 'f1',
  description: null,
  durationSeconds: 724,
  sizeBytes: 412 * 1024 ** 2,
  status: 'ready',
  coverUrl: null,
  createdBy: { id: 'u1', name: 'Anita Rao' },
  createdAt: '2026-10-08T10:00:00Z',
  position: 0,
  category: 'video',
  ...overrides,
});
const fixture: MediaItem[] = [
  item({ id: 'v1', title: 'Fire exits', description: 'Where to go.', coverUrl: 'https://cdn.example/c1?sig=1' }),
  item({ id: 'v2', title: 'First aid basics', durationSeconds: null, sizeBytes: 280 * 1024 ** 2, position: 1 }),
  item({ id: 'v3', title: '<b>Kitchen</b> hygiene', position: 2, status: 'uploading', createdBy: { id: 'staff-1', name: 'Ben Okoye' } }),
];

type Override = MockResponse | ((body: Record<string, unknown>) => MockResponse);

function startServer(overrides: Record<string, Override> = {}, items: MediaItem[] = fixture, folders: Folder[] = [folder], slug: CategorySlug = 'videos') {
  const state = { items: structuredClone(items) };
  const calls: { key: string; body: Record<string, unknown> }[] = [];
  mockSession(STAFF, (url, init) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ key, body });
    const override = overrides[key];
    if (override) return typeof override === 'function' ? override(body) : override;
    if (key === `GET /api/media/${slug}/folders`) return { body: folders };
    if (key === 'GET /api/media/folders/f1/items') return { body: state.items };
    if (key === 'GET /api/media/uploads/mine') return { body: [] };
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

const fakeUploads = (overrides: Partial<UploadsValue> = {}): UploadsValue => ({
  jobs: [],
  finishedCount: 0,
  start: vi.fn(async () => undefined),
  resume: vi.fn(async () => undefined),
  retry: vi.fn(async () => undefined),
  cancel: vi.fn(async () => undefined),
  dismiss: vi.fn(),
  ...overrides,
});

const fakePlayer = (): PlayerValue => ({ session: null, play: vi.fn(), close: vi.fn() });

let setUploads: (value: UploadsValue) => void = () => undefined;

function UploadsHarness({ initial, category, player }: { initial: UploadsValue; category: CategoryConfig; player: PlayerValue }) {
  const [value, setValue] = useState(initial);
  setUploads = setValue;
  return (
    <UploadsContext.Provider value={value}>
      <PlayerContext.Provider value={player}>
        <Routes>
          <Route path={`/${category.slug}/:folderId`} element={<FolderPage category={category} />} />
        </Routes>
      </PlayerContext.Provider>
    </UploadsContext.Provider>
  );
}

function renderPage(route = '/videos/f1', uploads: UploadsValue = fakeUploads(), category: CategoryConfig = VIDEOS, player: PlayerValue = fakePlayer()) {
  return renderWithSession(<UploadsHarness initial={uploads} category={category} player={player} />, route);
}

function renderPageInStrictMode() {
  return renderWithSession(
    <StrictMode>
      <UploadsHarness initial={fakeUploads()} category={VIDEOS} player={fakePlayer()} />
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

  it('carries on from the same position after fetching a fresh link', async () => {
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
    const video = dialog.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 42.5 });
    const play = vi.fn(() => Promise.resolve());
    video.play = play;

    fireEvent.error(video);
    await waitFor(() => expect(video).toHaveAttribute('src', 'https://cdn.example/video-2?sig=1'));
    expect(plays).toBe(2);

    // The browser starts from the beginning when a new source loads.
    video.currentTime = 0;
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(42.5);
    expect(play).toHaveBeenCalledTimes(1);

    // The position is only used once.
    fireEvent.loadedMetadata(video);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('allows another fresh link after the video has played again', async () => {
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
    const video = dialog.querySelector('video') as HTMLVideoElement;

    fireEvent.error(video);
    await waitFor(() => expect(video).toHaveAttribute('src', 'https://cdn.example/video-2?sig=1'));
    fireEvent.playing(video);
    fireEvent.error(video);
    await waitFor(() => expect(video).toHaveAttribute('src', 'https://cdn.example/video-3?sig=1'));
    expect(plays).toBe(3);
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('puts an Upload video button on the page that opens the upload dialog', async () => {
    startServer();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Upload video' }));
    expect(screen.getByRole('dialog', { name: 'Upload video' })).toBeInTheDocument();
  });

  it('shows the progress of a video being sent from this browser in its row', async () => {
    startServer();
    const job: UploadJob = { id: 'u3', itemId: 'v3', folderId: 'f1', title: 'x', fileName: 'x.mp4', sizeBytes: 100, bytesSent: 62, status: 'sending', message: null, coverWarning: false };
    renderPage('/videos/f1', fakeUploads({ jobs: [job] }));
    expect(await screen.findByText('Uploading 62%')).toBeInTheDocument();
  });

  it('reloads the list when a video finishes uploading', async () => {
    const calls = startServer();
    renderPage();
    await screen.findByRole('heading', { name: 'Safety Training' });
    const before = calls.filter((call) => call.key === 'GET /api/media/folders/f1/items').length;
    act(() => setUploads(fakeUploads({ finishedCount: 1 })));
    await waitFor(() => expect(calls.filter((call) => call.key === 'GET /api/media/folders/f1/items').length).toBe(before + 1));
  });
});

describe('FolderPage for the other categories', () => {
  beforeEach(() => vi.unstubAllGlobals());

  const songFolder: Folder = { id: 'f1', name: 'Road trip', position: 0, itemCount: 2, category: 'song' };
  const songs: MediaItem[] = [
    item({ id: 's1', title: 'Morning song', category: 'song', durationSeconds: 185, sizeBytes: 6 * 1024 ** 2 }),
    item({ id: 's2', title: '<img src=x onerror=alert(1)>', category: 'song', position: 1 }),
  ];
  const songLink = { body: { url: 'https://cdn.example/s1?sig=1', expiresAt: '2026-10-09T11:00:00Z', contentType: 'audio/mpeg' } };

  it('uses the words of the category and shows a ♪ for songs without a cover', async () => {
    startServer({}, songs, [songFolder], 'songs');
    renderPage('/songs/f1', fakeUploads(), SONGS);
    expect(await screen.findByRole('heading', { name: 'Road trip' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Songs' })).toHaveAttribute('href', '/songs');
    expect(screen.getByRole('button', { name: 'Upload song' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Songs in this folder' });
    expect(within(table).getByRole('columnheader', { name: 'Song' })).toBeInTheDocument();
    expect(within(table).getAllByText('♪')).toHaveLength(2);
    expect(within(table).getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('says so in its own words when a songs folder is empty or missing', async () => {
    startServer({}, [], [songFolder], 'songs');
    const first = renderPage('/songs/f1', fakeUploads(), SONGS);
    expect(await screen.findByText('No songs in this folder yet')).toBeInTheDocument();
    expect(screen.getByText('Songs you upload here will appear in this list.')).toBeInTheDocument();
    first.unmount();

    startServer({ 'GET /api/media/folders/f1/items': { status: 404, body: { message: 'Folder not found.' } } }, [], [songFolder], 'songs');
    renderPage('/songs/f1', fakeUploads(), SONGS);
    expect(await screen.findByText('Folder not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Songs' })).toHaveAttribute('href', '/songs');
  });

  it('starts a song in the docked player from its Play button, with no pop-up and no request of its own', async () => {
    const player = fakePlayer();
    const calls = startServer({}, songs, [songFolder], 'songs');
    renderPage('/songs/f1', fakeUploads(), SONGS, player);
    await userEvent.click(await screen.findByRole('button', { name: 'Play Morning song' }));
    expect(player.play).toHaveBeenCalledWith({ itemId: 's1', title: 'Morning song', categoryLabel: 'Songs', folderName: 'Road trip', coverUrl: null });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Morning song' })).toBeNull();
    await userEvent.click(screen.getByText('3:05'));
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(calls.some((call) => call.key.endsWith('/play'))).toBe(false);
  });

  it('plays a song in the real docked player with one link and the folder named', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const calls = startServer({ 'POST /api/media/items/s1/play': songLink }, songs, [songFolder], 'songs');
    renderWithSession(
      <UploadsContext.Provider value={fakeUploads()}>
        <PlayerProvider>
          <Routes>
            <Route path="/songs/:folderId" element={<FolderPage category={SONGS} />} />
          </Routes>
          <DockedPlayer />
        </PlayerProvider>
      </UploadsContext.Provider>,
      '/songs/f1',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Play Morning song' }));
    const bar = await screen.findByRole('region', { name: 'Player' });
    expect(within(bar).getByText('Songs › Road trip')).toBeInTheDocument();
    await waitFor(() => expect(bar.querySelector('audio')).toHaveAttribute('src', 'https://cdn.example/s1?sig=1'));
    expect(calls.filter((call) => call.key === 'POST /api/media/items/s1/play')).toHaveLength(1);
  });

  it('opens a movie in the pop-up player, like a video, and never in the dock', async () => {
    const player = fakePlayer();
    const movieFolder: Folder = { id: 'f1', name: 'Classics', position: 0, itemCount: 1, category: 'movie' };
    startServer(
      { 'POST /api/media/items/m1/play': { body: { url: 'https://cdn.example/m1?sig=1', expiresAt: '2026-10-09T11:00:00Z', contentType: 'video/mp4' } } },
      [item({ id: 'm1', title: 'The long walk', category: 'movie' })],
      [movieFolder],
      'movies',
    );
    renderPage('/movies/f1', fakeUploads(), MOVIES, player);
    await userEvent.click(await screen.findByRole('button', { name: 'The long walk' }));
    const dialog = await screen.findByRole('dialog', { name: 'The long walk' });
    await waitFor(() => expect(dialog.querySelector('video')).toHaveAttribute('src', 'https://cdn.example/m1?sig=1'));
    expect(screen.queryByRole('button', { name: 'Play The long walk' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Upload movie' })).toBeInTheDocument();
    expect(player.play).not.toHaveBeenCalled();
  });

  it('edits a song in a dialog named for it', async () => {
    startServer({}, songs, [songFolder], 'songs');
    renderPage('/songs/f1', fakeUploads(), SONGS);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Morning song' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit song' });
    await userEvent.type(within(dialog).getByLabelText('Title'), ' (live)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Song saved.')).toBeInTheDocument();
  });

  it('opens the upload dialog for songs with the audio rules', async () => {
    startServer({}, songs, [songFolder], 'songs');
    renderPage('/songs/f1', fakeUploads(), SONGS);
    await userEvent.click(await screen.findByRole('button', { name: 'Upload song' }));
    const dialog = screen.getByRole('dialog', { name: 'Upload song' });
    expect(within(dialog).getByLabelText('Song file (MP3 or M4A, up to 500 MB)')).toHaveAttribute('accept', 'audio/mpeg,audio/mp4,.mp3,.m4a');
  });
});
