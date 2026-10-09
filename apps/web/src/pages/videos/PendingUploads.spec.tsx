import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingUpload } from '../../api/media';
import { mockSession, renderWithSession, STAFF } from '../../test/session';
import { FileMismatchError, type UploadJob, UploadsContext, type UploadsValue } from '../../uploads/UploadsContext';
import { PendingUploads } from './PendingUploads';

const pending = (overrides: Partial<PendingUpload> & { fileId: string }): PendingUpload => ({
  itemId: `item-${overrides.fileId}`,
  folderId: 'f1',
  title: 'Fire exits',
  fileName: 'fire.mp4',
  sizeBytes: 412 * 1024 ** 2,
  createdAt: '2026-10-08T10:00:00Z',
  ...overrides,
});

function setup(list: PendingUpload[], jobs: UploadJob[] = [], overrides: Partial<UploadsValue> = {}) {
  mockSession(STAFF, (url) => (url === '/api/media/uploads/mine' ? { body: list } : { status: 404, body: {} }));
  const value: UploadsValue = { jobs, finishedCount: 0, start: vi.fn(), resume: vi.fn(async () => undefined), retry: vi.fn(), cancel: vi.fn(async () => undefined), dismiss: vi.fn(), ...overrides };
  const onChanged = vi.fn();
  const view = renderWithSession(
    <UploadsContext.Provider value={value}>
      <PendingUploads folderId="f1" reloadKey={0} onChanged={onChanged} />
    </UploadsContext.Provider>,
  );
  return { value, onChanged, view };
}

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
    setup([pending({ fileId: 'a', title: 'Mine here' })], [running]);
    await waitFor(() => expect(screen.queryByRole('table', { name: 'Unfinished uploads' })).toBeNull());
  });

  it('renders nothing when there are none', async () => {
    const { view } = setup([]);
    await waitFor(() => expect(view.container).toBeEmptyDOMElement());
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
});
