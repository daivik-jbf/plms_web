import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { type UploadJob, UploadsContext, type UploadsValue } from './UploadsContext';
import { UploadPanel } from './UploadPanel';

const job = (overrides: Partial<UploadJob> = {}): UploadJob => ({
  id: 'u1',
  itemId: 'v1',
  folderId: 'f1',
  title: 'Fire exits',
  fileName: 'fire-exits.mp4',
  sizeBytes: 2 * 1024 ** 3,
  bytesSent: Math.round(1.1 * 1024 ** 3),
  status: 'sending',
  message: null,
  coverWarning: false,
  ...overrides,
});

function renderPanel(jobs: UploadJob[]) {
  const value: UploadsValue = {
    jobs,
    finishedCount: 0,
    start: vi.fn(),
    resume: vi.fn(),
    retry: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    dismiss: vi.fn(),
  };
  render(
    <UploadsContext.Provider value={value}>
      <UploadPanel />
    </UploadsContext.Provider>,
  );
  return value;
}

describe('UploadPanel', () => {
  it('renders nothing when there are no uploads', () => {
    renderPanel([]);
    expect(screen.queryByRole('region', { name: 'Uploads' })).toBeNull();
  });

  it('shows a labelled progress bar with bytes sent, and Cancel', async () => {
    const value = renderPanel([job()]);
    const panel = screen.getByRole('region', { name: 'Uploads' });
    expect(within(panel).getByText('Fire exits')).toBeInTheDocument();
    expect(within(panel).getByText('fire-exits.mp4')).toBeInTheDocument();
    expect(within(panel).getByRole('progressbar', { name: 'Upload progress for Fire exits' })).toHaveAttribute('value', String(Math.round(1.1 * 1024 ** 3)));
    expect(within(panel).getByText('1.1 GB of 2 GB')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Cancel upload of Fire exits' }));
    expect(value.cancel).toHaveBeenCalledWith('u1');
  });

  it('says it is finishing, then finished, and lets the person dismiss', async () => {
    const value = renderPanel([job({ id: 'a', title: 'Finishing one', status: 'finishing' }), job({ id: 'b', title: 'Done one', status: 'done' })]);
    expect(screen.getByText('Finishing…')).toBeInTheDocument();
    expect(screen.getByText('Finished')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss Done one' }));
    expect(value.dismiss).toHaveBeenCalledWith('b');
  });

  it('offers no Cancel once the last piece is in and the server is checking the file', () => {
    renderPanel([job({ status: 'finishing' })]);
    expect(screen.queryByRole('button', { name: /Cancel upload/ })).toBeNull();
  });

  it('shows what went wrong with Try again and Dismiss, and a cover warning on a finished video', async () => {
    const value = renderPanel([
      job({ id: 'a', status: 'failed', message: 'The connection kept failing. Check your internet connection, then press Try again.' }),
      job({ id: 'b', title: 'Covered', status: 'done', coverWarning: true }),
    ]);
    expect(screen.getByRole('alert')).toHaveTextContent('connection kept failing');
    expect(screen.getByText(/cover image could not be added/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again with Fire exits' }));
    expect(value.retry).toHaveBeenCalledWith('a');
  });

  it('shows hostile titles as plain text', () => {
    renderPanel([job({ title: '<img src=x onerror=alert(1)>' })]);
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});
