import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Folder } from '../../api/media';
import type { MockResponse } from '../../test/fetch-mock';
import { mockSession, renderWithSession, STAFF } from '../../test/session';
import { VideosPage } from './VideosPage';

const fixture: Folder[] = [
  { id: 'f1', name: 'Safety Training', position: 0, itemCount: 4 },
  { id: 'f2', name: 'Kitchen', position: 1, itemCount: 0 },
  { id: 'f3', name: '<img src=x onerror=alert(1)>', position: 2, itemCount: 1 },
];

type Override = MockResponse | ((body: Record<string, unknown>) => MockResponse);

function startServer(overrides: Record<string, Override> = {}, initial: Folder[] = fixture) {
  const state = { folders: structuredClone(initial) };
  const calls: { key: string; body: Record<string, unknown> }[] = [];
  mockSession(STAFF, (url, init) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ key, body });
    const override = overrides[key];
    if (override) return typeof override === 'function' ? override(body) : override;
    if (key === 'GET /api/media/videos/folders') return { body: state.folders };
    if (key === 'POST /api/media/videos/folders') {
      const folder = { id: 'f-new', name: String(body.name), position: state.folders.length, itemCount: 0 };
      state.folders.push(folder);
      return { status: 201, body: folder };
    }
    const rename = /^PATCH \/api\/media\/folders\/([^/]+)$/.exec(key);
    if (rename) {
      const folder = state.folders.find((candidate) => candidate.id === rename[1])!;
      folder.name = String(body.name);
      return { body: folder };
    }
    if (key === 'PUT /api/media/videos/folders/order') {
      const ids = body.ids as string[];
      state.folders = ids.map((id, index) => ({ ...state.folders.find((folder) => folder.id === id)!, position: index }));
      return { body: state.folders };
    }
    return { status: 404, body: {} };
  });
  return calls;
}

describe('VideosPage', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('lists the folders with their video counts and an Open link to each', async () => {
    startServer();
    renderWithSession(<VideosPage />);
    const table = await screen.findByRole('table', { name: 'Video folders' });
    const row = within(table).getByRole('row', { name: /Safety Training/ });
    expect(within(row).getByText('4')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Open Safety Training' })).toHaveAttribute('href', '/videos/f1');
  });

  it('shows hostile folder names as plain text', async () => {
    startServer();
    renderWithSession(<VideosPage />);
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('shows an empty state with a way forward', async () => {
    startServer({}, []);
    renderWithSession(<VideosPage />);
    expect(await screen.findByText('No folders yet')).toBeInTheDocument();
    expect(screen.getByText(/create a folder/i)).toBeInTheDocument();
  });

  it('offers Retry when loading fails', async () => {
    let fail = true;
    startServer({ 'GET /api/media/videos/folders': () => (fail ? { status: 500, body: {} } : { body: fixture }) });
    renderWithSession(<VideosPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table', { name: 'Video folders' })).toBeInTheDocument();
  });

  it('creates a folder and shows it', async () => {
    const calls = startServer();
    renderWithSession(<VideosPage />);
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
    renderWithSession(<VideosPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'New folder' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create folder' }));
    expect(await screen.findByText('Enter a folder name.')).toBeInTheDocument();
    expect(screen.getByLabelText('Folder name')).toHaveFocus();
    expect(calls.some((call) => call.key.startsWith('POST'))).toBe(false);
  });

  it('keeps the dialog open and explains a name that already exists', async () => {
    startServer({ 'POST /api/media/videos/folders': { status: 409, body: { message: 'A folder with that name already exists.' } } });
    renderWithSession(<VideosPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'New folder' }));
    await userEvent.type(screen.getByLabelText('Folder name'), 'Kitchen');
    await userEvent.click(screen.getByRole('button', { name: 'Create folder' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    expect(screen.getByRole('dialog', { name: 'New folder' })).toBeInTheDocument();
  });

  it('renames a folder, starting from its current name', async () => {
    const calls = startServer();
    renderWithSession(<VideosPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Rename Kitchen' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename folder' });
    const field = within(dialog).getByLabelText('Folder name');
    expect(field).toHaveValue('Kitchen');
    await userEvent.clear(field);
    await userEvent.type(field, 'Canteen');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Folder renamed to "Canteen".')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'PATCH /api/media/folders/f2')?.body).toEqual({ name: 'Canteen' });
  });

  it('moves a folder down and disables the moves that are not possible', async () => {
    const calls = startServer();
    renderWithSession(<VideosPage />);
    await screen.findByRole('table', { name: 'Video folders' });
    expect(screen.getByRole('button', { name: 'Move Safety Training up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move <img src=x onerror=alert(1)> down' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move Safety Training down' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move Safety Training up' })).toBeEnabled());
    expect(calls.find((call) => call.key === 'PUT /api/media/videos/folders/order')?.body).toEqual({ ids: ['f2', 'f1', 'f3'] });
    const rows = within(screen.getByRole('table', { name: 'Video folders' })).getAllByRole('row').slice(1);
    expect(within(rows[0] as HTMLElement).getByRole('link', { name: 'Open Kitchen' })).toBeInTheDocument();
  });

  it('reloads and says so when the order changed under you', async () => {
    startServer({ 'PUT /api/media/videos/folders/order': { status: 409, body: { message: 'The list changed while you were editing it. Reload and try again.' } } });
    renderWithSession(<VideosPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Move Safety Training down' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The list changed');
  });
});
