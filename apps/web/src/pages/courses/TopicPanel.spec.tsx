import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, StrictMode, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Attachment, TopicDetail } from '../../api/courses';
import type { Folder, MediaItem, PendingUpload } from '../../api/media';
import { PlayerContext, type PlayerValue } from '../../player/PlayerContext';
import { type UploadJob, UploadsContext, type UploadsValue } from '../../uploads/UploadsContext';
import type { MockResponse } from '../../test/fetch-mock';
import { mockSession, renderWithSession, STAFF } from '../../test/session';
import { ATTACHMENT_ACCEPT } from '../../uploads/limits';
import { TopicPanel } from './TopicPanel';

const attachment = (overrides: Partial<Attachment> & { id: string; title: string }): Attachment => ({
  topicId: 't1',
  position: 0,
  kind: 'pdf',
  source: 'upload',
  status: 'ready',
  sizeBytes: 2048,
  durationSeconds: null,
  thumbnailUrl: null,
  libraryItemId: null,
  category: null,
  libraryFolderName: null,
  createdBy: { id: 'u1', name: 'Anita Rao' },
  createdAt: '2026-10-09T10:00:00Z',
  ...overrides,
});

const fixture: Attachment[] = [
  attachment({ id: 'a1', title: 'Exit map', kind: 'pdf', sizeBytes: 2 * 1024 ** 2 }),
  attachment({ id: 'a2', title: 'Safety briefing', kind: 'audio', position: 1, durationSeconds: 125, sizeBytes: 5 * 1024 ** 2 }),
  attachment({ id: 'a3', title: 'Floor plan', kind: 'image', position: 2, thumbnailUrl: 'https://cdn.example/thumb-a3?sig=1', sizeBytes: 300 * 1024 }),
  attachment({
    id: 'a4',
    title: 'Evacuation film',
    kind: 'video',
    position: 3,
    source: 'library',
    libraryItemId: 'v1',
    category: 'video',
    libraryFolderName: 'Safety Training',
    durationSeconds: 724,
    thumbnailUrl: 'https://cdn.example/cover-v1?sig=1',
    sizeBytes: 412 * 1024 ** 2,
  }),
  attachment({ id: 'a5', title: 'Morning song', kind: 'audio', position: 4, source: 'library', libraryItemId: 's1', category: 'song', libraryFolderName: 'Road trip', durationSeconds: 185, sizeBytes: 4 * 1024 ** 2 }),
];

const topic = (attachments: Attachment[], overrides: Partial<TopicDetail> = {}): TopicDetail => ({
  id: 't1',
  lessonId: 'l1',
  courseId: 'c1',
  title: 'Fire exits',
  description: null,
  position: 0,
  attachments,
  ...overrides,
});

const folders: Folder[] = [
  { id: 'f1', name: 'Safety Training', position: 0, itemCount: 2, category: 'video' },
  { id: 'f2', name: 'Kitchen', position: 1, itemCount: 0, category: 'video' },
];
const songFolders: Folder[] = [{ id: 'sf1', name: 'Road trip', position: 0, itemCount: 1, category: 'song' }];
const libraryItem = (overrides: Partial<MediaItem> & { id: string; title: string }): MediaItem => ({
  folderId: 'f1',
  description: null,
  durationSeconds: 90,
  sizeBytes: 10 * 1024 ** 2,
  status: 'ready',
  coverUrl: null,
  createdBy: { id: 'u1', name: 'Anita Rao' },
  createdAt: '2026-10-08T10:00:00Z',
  position: 0,
  category: 'video',
  ...overrides,
});
const items: Record<string, MediaItem[]> = {
  f1: [libraryItem({ id: 'v1', title: 'Fire exits film' }), libraryItem({ id: 'v2', title: 'First aid basics', position: 1 }), libraryItem({ id: 'v3', title: 'Still uploading', position: 2, status: 'uploading' })],
  f2: [],
  sf1: [libraryItem({ id: 's9', title: 'Calm song', folderId: 'sf1', category: 'song' })],
};

type Override = MockResponse | ((body: Record<string, unknown>) => MockResponse);

function startServer(initial: TopicDetail = topic(fixture), overrides: Record<string, Override> = {}) {
  const state = { topic: structuredClone(initial) };
  const calls: { key: string; body: Record<string, unknown> }[] = [];
  mockSession(STAFF, (url, init) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ key, body });
    const override = overrides[key];
    if (override) return typeof override === 'function' ? override(body) : override;
    if (key === 'GET /api/topics/t1') return { body: state.topic };
    if (key === 'GET /api/media/uploads/mine') return { body: [] };
    if (key === 'GET /api/media/videos/folders') return { body: folders };
    if (key === 'GET /api/media/songs/folders') return { body: songFolders };
    const folderItems = /^GET \/api\/media\/folders\/([^/]+)\/items$/.exec(key);
    if (folderItems) return { body: items[folderItems[1] as string] ?? [] };
    if (key === 'POST /api/topics/t1/attachments/library') {
      const created = attachment({ id: 'a-new', title: 'Fire exits film', kind: 'video', source: 'library', libraryItemId: String(body.itemId), category: 'video', libraryFolderName: 'Safety Training', position: state.topic.attachments.length });
      state.topic.attachments.push(created);
      return { status: 201, body: created };
    }
    const rename = /^PATCH \/api\/attachments\/([^/]+)$/.exec(key);
    if (rename) {
      const target = state.topic.attachments.find((candidate) => candidate.id === rename[1])!;
      target.title = String(body.title);
      return { body: target };
    }
    if (key === 'PUT /api/topics/t1/attachments/order') {
      const ids = body.ids as string[];
      const ready = ids.map((id) => state.topic.attachments.find((candidate) => candidate.id === id)!);
      state.topic.attachments = [...ready, ...state.topic.attachments.filter((candidate) => !ids.includes(candidate.id))];
      return { body: state.topic.attachments };
    }
    const open = /^POST \/api\/attachments\/([^/]+)\/open$/.exec(key);
    if (open) {
      const target = state.topic.attachments.find((candidate) => candidate.id === open[1])!;
      return { body: { url: `https://cdn.example/${open[1]}?sig=1`, expiresAt: '2026-10-09T11:00:00Z', contentType: 'application/octet-stream', kind: target.kind } };
    }
    return { status: 404, body: {} };
  });
  return calls;
}

const fakePlayer = (): PlayerValue => ({ session: null, play: vi.fn(), close: vi.fn() });

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

let setUploads: (value: UploadsValue) => void = () => undefined;

function Providers({ initial, player, children }: { initial: UploadsValue; player: PlayerValue; children: ReactNode }) {
  const [value, setValue] = useState(initial);
  setUploads = setValue;
  return (
    <UploadsContext.Provider value={value}>
      <PlayerContext.Provider value={player}>{children}</PlayerContext.Provider>
    </UploadsContext.Provider>
  );
}

function renderPanel(options: { player?: PlayerValue; uploads?: UploadsValue; strict?: boolean; onChanged?: () => void } = {}) {
  const { player = fakePlayer(), uploads = fakeUploads(), strict = false, onChanged = vi.fn() } = options;
  const panel = (
    <Providers initial={uploads} player={player}>
      <TopicPanel topicId="t1" courseTitle="Fire safety" lessonTitle="Exits" reloadKey={0} onChanged={onChanged} />
    </Providers>
  );
  renderWithSession(strict ? <StrictMode>{panel}</StrictMode> : panel);
  return { player, uploads, onChanged };
}

const row = (name: RegExp | string) => screen.getByRole('row', { name });

describe('TopicPanel attachments', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('lists the attachments in order with their type, length, size and source', async () => {
    startServer();
    renderPanel();
    const table = await screen.findByRole('table', { name: 'Attachments' });
    expect(within(table).getAllByRole('row').slice(1).map((entry) => within(entry).getAllByRole('cell')[0]!.textContent)).toEqual([
      expect.stringContaining('Exit map'),
      expect.stringContaining('Safety briefing'),
      expect.stringContaining('Floor plan'),
      expect.stringContaining('Evacuation film'),
      expect.stringContaining('Morning song'),
    ]);
    const pdf = row(/Exit map/);
    expect(within(pdf).getByText('PDF')).toBeInTheDocument();
    expect(within(pdf).getByText('2 MB')).toBeInTheDocument();
    const audio = row(/Safety briefing/);
    expect(within(audio).getByText('Audio')).toBeInTheDocument();
    expect(within(audio).getByText('2:05')).toBeInTheDocument();
    const library = row(/Evacuation film/);
    expect(within(library).getByText('12:04')).toBeInTheDocument();
    expect(within(library).getByText('412 MB')).toBeInTheDocument();
    expect(within(library).getByText('From Videos › Safety Training')).toBeInTheDocument();
    expect(within(row(/Morning song/)).getByText('From Songs › Road trip')).toBeInTheDocument();
  });

  it('shows a picture for an image and a library cover, and a glyph for the rest', async () => {
    startServer();
    renderPanel();
    await screen.findByRole('table', { name: 'Attachments' });
    const pictures = [...document.querySelectorAll('img')];
    expect(pictures.map((picture) => picture.getAttribute('src'))).toEqual(['https://cdn.example/thumb-a3?sig=1', 'https://cdn.example/cover-v1?sig=1']);
    expect(pictures.every((picture) => picture.getAttribute('alt') === '')).toBe(true);
  });

  it('shows hostile titles as plain text', async () => {
    startServer(topic([attachment({ id: 'a1', title: '<img src=x onerror=alert(1)>' })]));
    renderPanel();
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('shows an empty state with a way forward', async () => {
    startServer(topic([]));
    renderPanel();
    expect(await screen.findByText('No attachments yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('shows an attachment that is still uploading with a badge and no actions', async () => {
    startServer(topic([attachment({ id: 'a1', title: 'Exit map' }), attachment({ id: 'a9', title: 'Half a map', status: 'uploading', position: 1 })]));
    renderPanel();
    const unfinished = await screen.findByRole('row', { name: /Half a map/ });
    expect(within(unfinished).getByText('Uploading')).toBeInTheDocument();
    expect(within(unfinished).queryByRole('button')).toBeNull();
    expect(screen.getByRole('button', { name: 'Move Exit map down' })).toBeDisabled();
  });

  describe('opening', () => {
    it('opens a video in the pop-up player and asks for exactly one link', async () => {
      const calls = startServer();
      renderPanel({ strict: true });
      await userEvent.click(await screen.findByRole('button', { name: 'Open Evacuation film' }));
      const dialog = await screen.findByRole('dialog', { name: 'Evacuation film' });
      await waitFor(() => expect(dialog.querySelector('video')).toHaveAttribute('src', 'https://cdn.example/a4?sig=1'));
      expect(calls.filter((call) => call.key === 'POST /api/attachments/a4/open')).toHaveLength(1);
      expect(within(dialog).getByText(/Added by Anita Rao/)).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog', { name: 'Evacuation film' })).toBeNull();
    });

    it('starts uploaded audio in the dock under Course, Lesson and Topic, and asks for the link only when the dock does', async () => {
      const calls = startServer();
      const { player } = renderPanel();
      await userEvent.click(await screen.findByRole('button', { name: 'Open Safety briefing' }));
      expect(player.play).toHaveBeenCalledWith({ link: expect.any(Function), title: 'Safety briefing', place: 'Fire safety › Exits › Fire exits', coverUrl: null });
      expect(calls.some((call) => call.key.endsWith('/open'))).toBe(false);
      const track = vi.mocked(player.play).mock.calls[0]![0];
      await expect(track.link()).resolves.toMatchObject({ url: 'https://cdn.example/a2?sig=1' });
      expect(calls.filter((call) => call.key === 'POST /api/attachments/a2/open')).toHaveLength(1);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('starts library audio in the dock under its category and folder, with the cover', async () => {
      startServer(topic([fixture[4]!, attachment({ id: 'a6', title: 'Calm', kind: 'audio', source: 'library', libraryItemId: 's2', category: 'podcast', libraryFolderName: 'Weekly', thumbnailUrl: 'https://cdn.example/c?sig=1', position: 1 })]));
      const { player } = renderPanel();
      await userEvent.click(await screen.findByRole('button', { name: 'Open Morning song' }));
      expect(player.play).toHaveBeenLastCalledWith({ link: expect.any(Function), title: 'Morning song', place: 'Songs › Road trip', coverUrl: null });
      await userEvent.click(screen.getByRole('button', { name: 'Open Calm' }));
      expect(player.play).toHaveBeenLastCalledWith({ link: expect.any(Function), title: 'Calm', place: 'Podcasts › Weekly', coverUrl: 'https://cdn.example/c?sig=1' });
    });

    it('opens the tab for a PDF straight from the click, then sends it to the link when it arrives', async () => {
      let release: (value: MockResponse) => void = () => undefined;
      const pending = new Promise<MockResponse>((resolve) => (release = resolve));
      startServer(topic(fixture), { 'POST /api/attachments/a1/open': () => pending as unknown as MockResponse });
      const tab = { location: { href: 'about:blank' }, close: vi.fn(), opener: {} as unknown };
      const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
      renderPanel();
      await userEvent.click(await screen.findByRole('button', { name: 'Open Exit map' }));
      expect(open).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledWith('', '_blank');
      expect(tab.opener).toBeNull();
      expect(tab.location.href).toBe('about:blank');
      release({ body: { url: 'https://cdn.example/a1?sig=1', expiresAt: '2026-10-09T11:00:00Z', contentType: 'application/pdf', kind: 'pdf' } });
      await waitFor(() => expect(tab.location.href).toBe('https://cdn.example/a1?sig=1'));
      expect(tab.close).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(localStorage).toHaveLength(0);
      expect(sessionStorage).toHaveLength(0);
    });

    it('says so, and asks for no link, when the browser blocks the new tab', async () => {
      const calls = startServer();
      vi.spyOn(window, 'open').mockReturnValue(null);
      renderPanel();
      await userEvent.click(await screen.findByRole('button', { name: 'Open Exit map' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Your browser blocked the new tab. Allow pop-ups for this site, then try again.');
      expect(calls.some((call) => call.key.endsWith('/open'))).toBe(false);
    });

    it('closes the empty tab and explains when the link cannot be had', async () => {
      startServer(topic(fixture), { 'POST /api/attachments/a1/open': { status: 500, body: {} } });
      const tab = { location: { href: 'about:blank' }, close: vi.fn(), opener: {} as unknown };
      vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
      renderPanel();
      await userEvent.click(await screen.findByRole('button', { name: 'Open Exit map' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
      expect(tab.close).toHaveBeenCalledTimes(1);
      expect(tab.location.href).toBe('about:blank');
    });

    it('opens an image larger in a pop-up, asking for one link, and shows it with its title as the description', async () => {
      const calls = startServer();
      renderPanel({ strict: true });
      await userEvent.click(await screen.findByRole('button', { name: 'Open Floor plan' }));
      const dialog = await screen.findByRole('dialog', { name: 'Floor plan' });
      const picture = await within(dialog).findByRole('img', { name: 'Floor plan' });
      expect(picture).toHaveAttribute('src', 'https://cdn.example/a3?sig=1');
      expect(calls.filter((call) => call.key === 'POST /api/attachments/a3/open')).toHaveLength(1);
      expect(localStorage).toHaveLength(0);
      expect(sessionStorage).toHaveLength(0);
    });

    it('asks once for a fresh link when the image stops loading, then says so with Try again', async () => {
      const calls = startServer();
      renderPanel();
      await userEvent.click(await screen.findByRole('button', { name: 'Open Floor plan' }));
      const dialog = await screen.findByRole('dialog', { name: 'Floor plan' });
      fireEvent.error(await within(dialog).findByRole('img', { name: 'Floor plan' }));
      await waitFor(() => expect(calls.filter((call) => call.key === 'POST /api/attachments/a3/open')).toHaveLength(2));
      fireEvent.error(await within(dialog).findByRole('img', { name: 'Floor plan' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('This image could not be shown. Please try again later.');
      expect(calls.filter((call) => call.key === 'POST /api/attachments/a3/open')).toHaveLength(2);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(calls.filter((call) => call.key === 'POST /api/attachments/a3/open')).toHaveLength(3));
    });

    it('explains an open that the server refuses, inside the pop-up', async () => {
      startServer(topic(fixture), { 'POST /api/attachments/a3/open': { status: 409, body: { message: 'This item is not available.' } } });
      renderPanel();
      await userEvent.click(await screen.findByRole('button', { name: 'Open Floor plan' }));
      const dialog = await screen.findByRole('dialog', { name: 'Floor plan' });
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('This item is not available.');
    });
  });

  describe('renaming and moving', () => {
    it('renames an attachment, starting from its current title', async () => {
      const calls = startServer();
      renderPanel();
      await userEvent.click(await screen.findByRole('button', { name: 'Rename Exit map' }));
      const dialog = screen.getByRole('dialog', { name: 'Rename attachment' });
      const field = within(dialog).getByLabelText('Attachment title');
      expect(field).toHaveValue('Exit map');
      await userEvent.clear(field);
      await userEvent.type(field, '  Exit route map ');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      expect(await screen.findByText('Attachment renamed to "Exit route map".')).toBeInTheDocument();
      expect(calls.find((call) => call.key === 'PATCH /api/attachments/a1')?.body).toEqual({ title: 'Exit route map' });
      expect(await screen.findByRole('row', { name: /Exit route map/ })).toBeInTheDocument();
    });

    it('moves an attachment down and sends the order of the ready attachments only', async () => {
      const calls = startServer(topic([...fixture.slice(0, 2), attachment({ id: 'a9', title: 'Unfinished', status: 'uploading', position: 2 })]));
      renderPanel();
      await screen.findByRole('table', { name: 'Attachments' });
      expect(screen.getByRole('button', { name: 'Move Exit map up' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Move Safety briefing down' })).toBeDisabled();
      await userEvent.click(screen.getByRole('button', { name: 'Move Exit map down' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Move Exit map up' })).toBeEnabled());
      expect(calls.find((call) => call.key === 'PUT /api/topics/t1/attachments/order')?.body).toEqual({ ids: ['a2', 'a1'] });
      const rows = within(screen.getByRole('table', { name: 'Attachments' })).getAllByRole('row').slice(1);
      expect(rows[0]).toHaveTextContent('Safety briefing');
      expect(rows[2]).toHaveTextContent('Unfinished');
    });

    it('says so and reloads when the order changed under you', async () => {
      const calls = startServer(topic(fixture), { 'PUT /api/topics/t1/attachments/order': { status: 409, body: { message: 'The list changed while you were editing it. Reload and try again.' } } });
      renderPanel();
      await userEvent.click(await screen.findByRole('button', { name: 'Move Exit map down' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('The list changed');
      await waitFor(() => expect(calls.filter((call) => call.key === 'GET /api/topics/t1')).toHaveLength(2));
    });
  });

  describe('adding from the library', () => {
    const openPicker = async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Add' }));
      await userEvent.click(within(await screen.findByRole('dialog', { name: 'Add an attachment' })).getByRole('button', { name: 'From the library' }));
      return screen.findByRole('dialog', { name: 'Add from the library' });
    };

    it('offers the ready items of the first Videos folder, and not the ones still uploading', async () => {
      startServer(topic([]));
      renderPanel();
      const dialog = await openPicker();
      expect(await within(dialog).findByLabelText('Category')).toHaveValue('videos');
      await waitFor(() => expect(within(dialog).getByLabelText('Folder')).toHaveValue('f1'));
      expect(await within(dialog).findByText('Fire exits film')).toBeInTheDocument();
      expect(within(dialog).getByText('First aid basics')).toBeInTheDocument();
      expect(within(dialog).queryByText('Still uploading')).toBeNull();
      expect(within(dialog).getAllByRole('option', { name: /Videos|Movies|Podcasts|Songs/ }).map((option) => option.textContent)).toEqual(['Videos', 'Movies', 'Podcasts', 'Songs']);
    });

    it('searches the folder by title, ignoring case, and says when nothing matches', async () => {
      startServer(topic([]));
      renderPanel();
      const dialog = await openPicker();
      await within(dialog).findByText('Fire exits film');
      await userEvent.type(within(dialog).getByLabelText('Search by title'), 'FIRST');
      expect(within(dialog).queryByText('Fire exits film')).toBeNull();
      expect(within(dialog).getByText('First aid basics')).toBeInTheDocument();
      await userEvent.clear(within(dialog).getByLabelText('Search by title'));
      await userEvent.type(within(dialog).getByLabelText('Search by title'), 'zzz');
      expect(within(dialog).getByText('No ready items match.')).toBeInTheDocument();
    });

    it('changes folder and category, loading each list', async () => {
      const calls = startServer(topic([]));
      renderPanel();
      const dialog = await openPicker();
      await within(dialog).findByText('Fire exits film');
      await userEvent.selectOptions(within(dialog).getByLabelText('Folder'), 'f2');
      expect(await within(dialog).findByText('Nothing ready in this folder yet.')).toBeInTheDocument();
      await userEvent.selectOptions(within(dialog).getByLabelText('Category'), 'songs');
      expect(await within(dialog).findByText('Calm song')).toBeInTheDocument();
      expect(within(dialog).getByLabelText('Folder')).toHaveValue('sf1');
      expect(calls.some((call) => call.key === 'GET /api/media/songs/folders')).toBe(true);
    });

    it('says so when a category has no folders', async () => {
      startServer(topic([]), { 'GET /api/media/songs/folders': { body: [] } });
      renderPanel();
      const dialog = await openPicker();
      await userEvent.selectOptions(await within(dialog).findByLabelText('Category'), 'songs');
      expect(await within(dialog).findByText('No folders in Songs yet.')).toBeInTheDocument();
    });

    it('attaches the chosen item, closes, says so and reloads the topic', async () => {
      const calls = startServer(topic([]));
      const { onChanged } = renderPanel();
      const dialog = await openPicker();
      await userEvent.click(await within(dialog).findByRole('button', { name: 'Attach Fire exits film' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add from the library' })).toBeNull());
      expect(calls.find((call) => call.key === 'POST /api/topics/t1/attachments/library')?.body).toEqual({ itemId: 'v1' });
      expect(await screen.findByText('Added "Fire exits film" to the topic.')).toBeInTheDocument();
      expect(await screen.findByRole('row', { name: /Fire exits film/ })).toBeInTheDocument();
      expect(onChanged).toHaveBeenCalled();
    });

    it('keeps the dialog open and explains when the attachment is refused', async () => {
      startServer(topic([]), { 'POST /api/topics/t1/attachments/library': { status: 409, body: { message: 'That item is still uploading.' } } });
      renderPanel();
      const dialog = await openPicker();
      await userEvent.click(await within(dialog).findByRole('button', { name: 'Attach Fire exits film' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('That item is still uploading.');
      expect(screen.getByRole('dialog', { name: 'Add from the library' })).toBeInTheDocument();
    });

    it('offers Retry when the folders cannot be loaded', async () => {
      let fail = true;
      startServer(topic([]), { 'GET /api/media/videos/folders': () => (fail ? { status: 500, body: {} } : { body: folders }) });
      renderPanel();
      const dialog = await openPicker();
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Something went wrong');
      fail = false;
      await userEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
      expect(await within(dialog).findByText('Fire exits film')).toBeInTheDocument();
    });

    it('ignores the answer for a category the person has already left', async () => {
      let releaseVideos: (value: MockResponse) => void = () => undefined;
      const slow = new Promise<MockResponse>((resolve) => (releaseVideos = resolve));
      startServer(topic([]), { 'GET /api/media/videos/folders': () => slow as unknown as MockResponse });
      renderPanel();
      const dialog = await openPicker();
      await userEvent.selectOptions(await within(dialog).findByLabelText('Category'), 'songs');
      expect(await within(dialog).findByText('Calm song')).toBeInTheDocument();
      await act(async () => releaseVideos({ body: folders }));
      expect(within(dialog).getByLabelText('Category')).toHaveValue('songs');
      expect(within(dialog).getByLabelText('Folder')).toHaveValue('sf1');
      expect(within(dialog).queryByText('Fire exits film')).toBeNull();
    });
  });
});

describe('TopicPanel uploads', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const uploadJob = (overrides: Partial<UploadJob> = {}): UploadJob => ({
    id: 'u9',
    itemId: 'a9',
    folderId: null,
    topicId: 't1',
    title: 'Half a map',
    fileName: 'map.pdf',
    sizeBytes: 200,
    bytesSent: 50,
    status: 'sending',
    message: null,
    coverWarning: false,
    ...overrides,
  });

  it('offers to upload a file or to pick one from the library', async () => {
    startServer(topic([]));
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Add' }));
    const dialog = screen.getByRole('dialog', { name: 'Add an attachment' });
    expect(within(dialog).getByRole('button', { name: 'Upload a file' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'From the library' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload a file' }));
    expect(screen.queryByRole('dialog', { name: 'Add an attachment' })).toBeNull();
    expect(await screen.findByRole('dialog', { name: 'Upload a file' })).toBeInTheDocument();
  });

  it('starts the upload into this topic through the upload manager, and reloads the topic', async () => {
    const calls = startServer(topic([]));
    const { uploads, onChanged } = renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await userEvent.click(screen.getByRole('button', { name: 'Upload a file' }));
    const dialog = await screen.findByRole('dialog', { name: 'Upload a file' });
    const file = new File([new Uint8Array(10)], 'Exit map.pdf', { type: 'application/pdf' });
    await userEvent.upload(within(dialog).getByLabelText(/^File/), file);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    await waitFor(() => expect(uploads.start).toHaveBeenCalledWith({ file, topicId: 't1', contentType: 'application/pdf', title: 'Exit map', durationSeconds: null }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Upload a file' })).toBeNull());
    await waitFor(() => expect(calls.filter((call) => call.key === 'GET /api/topics/t1')).toHaveLength(2));
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows how far an upload of this topic has got, and ignores jobs of other topics and folders', async () => {
    startServer(topic([attachment({ id: 'a1', title: 'Exit map' }), attachment({ id: 'a9', title: 'Half a map', status: 'uploading', position: 1 })]));
    renderPanel({ uploads: fakeUploads({ jobs: [uploadJob(), uploadJob({ id: 'u8', itemId: 'a1', topicId: 't2', bytesSent: 100 })] }) });
    const unfinished = await screen.findByRole('row', { name: /Half a map/ });
    expect(within(unfinished).getByText('Uploading 25%')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Exit map/ })).queryByText(/Uploading/)).toBeNull();
  });

  it('reloads the topic when an upload finishes', async () => {
    const calls = startServer(topic([]));
    renderPanel();
    await screen.findByText('No attachments yet');
    expect(calls.filter((call) => call.key === 'GET /api/topics/t1')).toHaveLength(1);
    act(() => setUploads(fakeUploads({ finishedCount: 1 })));
    await waitFor(() => expect(calls.filter((call) => call.key === 'GET /api/topics/t1')).toHaveLength(2));
  });

  describe('the list of unfinished uploads', () => {
    const entry = (overrides: Partial<PendingUpload> & { fileId: string }): PendingUpload => ({
      itemId: `a-${overrides.fileId}`,
      folderId: null,
      topicId: 't1',
      title: 'Half a map',
      fileName: 'map.pdf',
      sizeBytes: 1024,
      createdAt: '2026-10-09T10:00:00Z',
      ...overrides,
    });

    it('lists the unfinished uploads of this topic only, in the words of attachments', async () => {
      startServer(topic([]), {
        'GET /api/media/uploads/mine': {
          body: [entry({ fileId: 'u1' }), entry({ fileId: 'u2', title: 'Other topic', topicId: 't2' }), entry({ fileId: 'u3', title: 'A library video', topicId: null, folderId: 'f1' })],
        },
      });
      renderPanel();
      const table = await screen.findByRole('table', { name: 'Unfinished uploads' });
      expect(within(table).getByText('Half a map')).toBeInTheDocument();
      expect(within(table).queryByText('Other topic')).toBeNull();
      expect(within(table).queryByText('A library video')).toBeNull();
      expect(within(table).getByRole('columnheader', { name: 'Attachment' })).toBeInTheDocument();
    });

    it('resumes with the same file, asking for any allowed type', async () => {
      startServer(topic([]), { 'GET /api/media/uploads/mine': { body: [entry({ fileId: 'u1' })] } });
      const { uploads } = renderPanel();
      await screen.findByRole('table', { name: 'Unfinished uploads' });
      await userEvent.click(screen.getByRole('button', { name: 'Resume Half a map' }));
      const input = document.querySelector('input[type="file"][hidden]') as HTMLInputElement;
      expect(input).toHaveAttribute('accept', ATTACHMENT_ACCEPT);
      const file = new File([new Uint8Array(3)], 'map.pdf', { type: 'application/pdf' });
      await userEvent.upload(input, file);
      await waitFor(() => expect(uploads.resume).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'u1', topicId: 't1' }), file));
    });

    it('cancels an unfinished upload after a confirmation that speaks of attachments', async () => {
      startServer(topic([]), { 'GET /api/media/uploads/mine': { body: [entry({ fileId: 'u1' })] } });
      const { uploads } = renderPanel();
      await userEvent.click(await screen.findByRole('button', { name: 'Cancel upload of Half a map' }));
      const dialog = screen.getByRole('dialog', { name: 'Cancel this upload?' });
      expect(dialog).toHaveTextContent('You can upload the attachment again later.');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel upload' }));
      await waitFor(() => expect(uploads.cancel).toHaveBeenCalledWith('u1'));
    });
  });
});
