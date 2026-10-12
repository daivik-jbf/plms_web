import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { mockSession, renderWithSession, STAFF } from '../../test/session';
import { readDuration } from '../../uploads/duration';
import { ATTACHMENT_ACCEPT, ATTACHMENT_HELP, MAX_COVER_BYTES, MAX_PDF_BYTES } from '../../uploads/limits';
import { UploadsContext, type UploadsValue } from '../../uploads/UploadsContext';
import { AttachmentUploadDialog } from './AttachmentUploadDialog';

vi.mock('../../uploads/duration', () => ({ readDuration: vi.fn(async () => 42) }));

const sized = (name: string, type: string, size: number): File => {
  const made = new File(['x'], name, { type });
  Object.defineProperty(made, 'size', { value: size });
  return made;
};

function setup(start: UploadsValue['start'] = vi.fn(async () => undefined)) {
  mockSession(STAFF);
  const value: UploadsValue = { jobs: [], finishedCount: 0, start, resume: vi.fn(), retry: vi.fn(), cancel: vi.fn(), dismiss: vi.fn() };
  const onClose = vi.fn();
  const onStarted = vi.fn();
  renderWithSession(
    <UploadsContext.Provider value={value}>
      <AttachmentUploadDialog open topicId="t1" onClose={onClose} onStarted={onStarted} />
    </UploadsContext.Provider>,
  );
  const dialog = screen.getByRole('dialog', { name: 'Upload a file' });
  return { dialog, start, onClose, onStarted };
}

describe('AttachmentUploadDialog', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(readDuration).mockClear();
  });

  it('asks for any of the four kinds, and says how large each may be', () => {
    const { dialog } = setup();
    expect(within(dialog).getByLabelText(/^File/)).toHaveAttribute('accept', ATTACHMENT_ACCEPT);
    expect(within(dialog).getByText(/2 GB for video, 500 MB for audio, 50 MB for a PDF and 10 MB for an image/)).toBeInTheDocument();
  });

  it('fills in the title from the file name, without the extension, until the person types their own', async () => {
    const { dialog } = setup();
    await userEvent.upload(within(dialog).getByLabelText(/^File/), new File(['x'], 'Exit map.pdf', { type: 'application/pdf' }));
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Exit map');
    await userEvent.clear(within(dialog).getByLabelText('Title'));
    await userEvent.type(within(dialog).getByLabelText('Title'), 'My own title');
    await userEvent.upload(within(dialog).getByLabelText(/^File/), new File(['x'], 'Other.pdf', { type: 'application/pdf' }));
    expect(within(dialog).getByLabelText('Title')).toHaveValue('My own title');
  });

  it.each([
    ['a PDF', 'Exit map.pdf', 'application/pdf', 'application/pdf', null],
    ['an image', 'Floor plan.png', 'image/png', 'image/png', null],
    ['a video', 'Film.mp4', 'video/mp4', 'video/mp4', 'video'],
    ['an MP3', 'Briefing.mp3', 'audio/mpeg', 'audio/mpeg', 'audio'],
    ['an M4A the system calls audio/x-m4a', 'Briefing.m4a', 'audio/x-m4a', 'audio/mp4', 'audio'],
    ['a PDF the system did not type', 'Plan.PDF', '', 'application/pdf', null],
  ])('starts %s with the declared type, the trimmed title and a length only where there is one to read', async (_name, fileName, type, declared, readAs) => {
    const { dialog, start, onClose, onStarted } = setup();
    const file = new File([new Uint8Array(10)], fileName, { type });
    await userEvent.upload(within(dialog).getByLabelText(/^File/), file);
    const title = within(dialog).getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, '  Our file  ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(start).toHaveBeenCalledWith({ file, topicId: 't1', contentType: declared, title: 'Our file', durationSeconds: readAs ? 42 : null });
    expect(vi.mocked(readDuration).mock.calls).toEqual(readAs ? [[file, readAs]] : []);
    await vi.waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('asks for a file and a title before sending anything', async () => {
    const { dialog, start } = setup();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(await within(dialog).findByText('Choose a file.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a title.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^File/)).toHaveFocus();
    expect(start).not.toHaveBeenCalled();
  });

  it.each([
    ['a type that is not allowed', sized('notes.zip', 'application/zip', 10), ATTACHMENT_HELP],
    ['an empty file', sized('a.pdf', 'application/pdf', 0), 'That file is empty.'],
    ['a PDF over 50 MB', sized('a.pdf', 'application/pdf', MAX_PDF_BYTES + 1), 'PDF files can be at most 50 MB. Choose a smaller file.'],
    ['an image over 10 MB', sized('a.png', 'image/png', MAX_COVER_BYTES + 1), 'Images can be at most 10 MB. Choose a smaller file.'],
  ])('refuses %s with the reason and never reads its length', async (_name, file, message) => {
    const { dialog, start } = setup();
    await userEvent.upload(within(dialog).getByLabelText(/^File/), file, { applyAccept: false });
    expect(await within(dialog).findByText(message)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(start).not.toHaveBeenCalled();
    expect(readDuration).not.toHaveBeenCalled();
  });

  it('shows the server\'s refusal of the file or the title and stays open', async () => {
    const start = vi.fn(async () => {
      throw new ApiError(400, 'Validation failed', { contentType: ['Attachments can be MP4 videos, MP3 or M4A audio files, PDF files, or JPEG, PNG or WebP images.'], title: ['Title must be 200 characters or fewer.'] });
    });
    const { dialog, onClose } = setup(start);
    await userEvent.upload(within(dialog).getByLabelText(/^File/), new File(['x'], 'a.pdf', { type: 'application/pdf' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(await within(dialog).findByText(/Attachments can be MP4 videos/)).toBeInTheDocument();
    expect(within(dialog).getByText('Title must be 200 characters or fewer.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows a general failure in an alert and stays open', async () => {
    const start = vi.fn(async () => {
      throw new ApiError(404, 'Topic not found.');
    });
    const { dialog, onClose } = setup(start);
    await userEvent.upload(within(dialog).getByLabelText(/^File/), new File(['x'], 'a.pdf', { type: 'application/pdf' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Topic not found.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cannot be dismissed while the start is being sent', async () => {
    let release: () => void = () => undefined;
    const start = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const { dialog, onStarted } = setup(start);
    await userEvent.upload(within(dialog).getByLabelText(/^File/), new File(['x'], 'a.pdf', { type: 'application/pdf' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    await vi.waitFor(() => expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled());
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    release();
    await vi.waitFor(() => expect(onStarted).toHaveBeenCalled());
  });
});
