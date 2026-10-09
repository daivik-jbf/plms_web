import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingUpload } from '../../api/media';
import { type CategoryConfig, CATEGORIES } from '../../media/categories';
import { mockSession, renderWithSession, STAFF } from '../../test/session';
import { FileMismatchError, type UploadJob, UploadsContext, UploadsProvider, type UploadsValue } from '../../uploads/UploadsContext';
import { PendingUploads } from './PendingUploads';

const VIDEOS = CATEGORIES.find((entry) => entry.slug === 'videos')!;
const SONGS = CATEGORIES.find((entry) => entry.slug === 'songs')!;

const pending = (overrides: Partial<PendingUpload> & { fileId: string }): PendingUpload => ({
  itemId: `item-${overrides.fileId}`,
  folderId: 'f1',
  title: 'Fire exits',
  fileName: 'fire.mp4',
  sizeBytes: 412 * 1024 ** 2,
  createdAt: '2026-10-08T10:00:00Z',
  ...overrides,
});

function setup(list: PendingUpload[], jobs: UploadJob[] = [], overrides: Partial<UploadsValue> = {}, category: CategoryConfig = VIDEOS) {
  const fetchMock = mockSession(STAFF, (url) => (url === '/api/media/uploads/mine' ? { body: list } : { status: 404, body: {} }));
  const value: UploadsValue = { jobs, finishedCount: 0, start: vi.fn(), resume: vi.fn(async () => undefined), retry: vi.fn(), cancel: vi.fn(async () => undefined), dismiss: vi.fn(), ...overrides };
  const onChanged = vi.fn();
  const view = renderWithSession(
    <UploadsContext.Provider value={value}>
      <PendingUploads category={category} folderId="f1" reloadKey={0} onChanged={onChanged} />
    </UploadsContext.Provider>,
  );
  return { value, onChanged, view, fetchMock };
}

const listWasFetched = (fetchMock: ReturnType<typeof setup>['fetchMock']) =>
  waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/media/uploads/mine')).toBe(true));

// Lets the response that was just received be turned into state before the test looks at the page.
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));

describe('PendingUploads', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('lists unfinished uploads of this folder, and nothing else', async () => {
    setup([pending({ fileId: 'a', title: 'Mine here' }), pending({ fileId: 'b', title: 'Other folder', folderId: 'f2' })]);
    expect(await screen.findByRole('table', { name: 'Unfinished uploads' })).toBeInTheDocument();
    expect(screen.getByText('Mine here')).toBeInTheDocument();
    expect(screen.queryByText('Other folder')).toBeNull();
  });

  it('does not list uploads that are running in this browser right now', async () => {
    const running: UploadJob = { id: 'a', itemId: 'item-a', folderId: 'f1', title: 'Mine here', fileName: 'fire.mp4', sizeBytes: 5, bytesSent: 1, status: 'sending', message: null, coverWarning: false };
    setup([pending({ fileId: 'a', title: 'Mine here' }), pending({ fileId: 'c', title: 'Stopped by a reload' })], [running]);
    expect(await screen.findByText('Stopped by a reload')).toBeInTheDocument();
    expect(screen.queryByText('Mine here')).toBeNull();
  });

  it('renders nothing when there are none', async () => {
    const { view, fetchMock } = setup([]);
    await listWasFetched(fetchMock);
    await settle();
    expect(view.container).toBeEmptyDOMElement();
  });

  it('resumes with the file the person chooses', async () => {
    const { value, view } = setup([pending({ fileId: 'a' })]);
    await screen.findByRole('table', { name: 'Unfinished uploads' });
    const file = new File([new Uint8Array(3)], 'fire.mp4', { type: 'video/mp4' });
    await userEvent.click(screen.getByRole('button', { name: 'Resume Fire exits' }));
    await userEvent.upload(view.container.querySelector('input[type="file"]') as HTMLInputElement, file);
    await waitFor(() => expect(value.resume).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'a' }), file));
  });

  it('says which file is needed when the wrong one is chosen', async () => {
    const entry = pending({ fileId: 'a' });
    const { view } = setup([entry], [], { resume: vi.fn(async () => Promise.reject(new FileMismatchError(entry))) });
    await screen.findByRole('table', { name: 'Unfinished uploads' });
    await userEvent.click(screen.getByRole('button', { name: 'Resume Fire exits' }));
    await userEvent.upload(view.container.querySelector('input[type="file"]') as HTMLInputElement, new File(['x'], 'other.mp4', { type: 'video/mp4' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose the same file you started with: "fire.mp4"');
  });

  it('cancels an unfinished upload after a confirmation', async () => {
    const { value, onChanged } = setup([pending({ fileId: 'a' })]);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel upload of Fire exits' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel this upload?' });
    expect(value.cancel).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel upload' }));
    await waitFor(() => expect(value.cancel).toHaveBeenCalledWith('a'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('keeps the upload listed and explains when cancelling fails', async () => {
    const { onChanged } = setup([pending({ fileId: 'a' })], [], { cancel: vi.fn(async () => Promise.reject(new Error('boom'))) });
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel upload of Fire exits' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Cancel this upload?' })).getByRole('button', { name: 'Cancel upload' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume Fire exits' })).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('shows hostile titles as plain text', async () => {
    setup([pending({ fileId: 'a', title: '<img src=x onerror=alert(1)>' })]);
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('shows the failure and keeps the row when the real manager cannot cancel an upload from before a reload', async () => {
    const fetchMock = mockSession(STAFF, (url, init) => {
      if (url === '/api/media/uploads/mine') return { body: [pending({ fileId: 'a' })] };
      if (url === '/api/media/uploads/a' && init.method === 'DELETE') return { status: 500, body: {} };
      return { status: 404, body: {} };
    });
    const onChanged = vi.fn();
    renderWithSession(
      <UploadsProvider>
        <PendingUploads category={VIDEOS} folderId="f1" reloadKey={0} onChanged={onChanged} />
      </UploadsProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel upload of Fire exits' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Cancel this upload?' })).getByRole('button', { name: 'Cancel upload' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(fetchMock.mock.calls.some(([url, init]) => String(url) === '/api/media/uploads/a' && init?.method === 'DELETE')).toBe(true);
    expect(screen.getByRole('button', { name: 'Resume Fire exits' })).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('asks for the kind of file the folder takes, in its words', async () => {
    const { view } = setup([pending({ fileId: 'a', fileName: 'song.mp3' })], [], {}, SONGS);
    await screen.findByRole('table', { name: 'Unfinished uploads' });
    expect(view.container.querySelector('input[type="file"]')).toHaveAttribute('accept', 'audio/mpeg,audio/mp4,.mp3,.m4a');
    expect(screen.getByRole('columnheader', { name: 'Song' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel upload of Fire exits' }));
    expect(screen.getByRole('dialog', { name: 'Cancel this upload?' })).toHaveTextContent('You can upload the song again later.');
  });
});
