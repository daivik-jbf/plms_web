import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { type CategoryConfig, CATEGORIES } from '../../media/categories';
import { mockSession, renderWithSession, STAFF } from '../../test/session';
import { readDuration } from '../../uploads/duration';
import { MAX_AUDIO_BYTES, MAX_VIDEO_BYTES } from '../../uploads/limits';
import { UploadsContext, type UploadsValue } from '../../uploads/UploadsContext';
import { UploadDialog } from './UploadDialog';

vi.mock('../../uploads/duration', () => ({ readDuration: vi.fn(async () => 42) }));

const VIDEOS = CATEGORIES.find((entry) => entry.slug === 'videos')!;
const SONGS = CATEGORIES.find((entry) => entry.slug === 'songs')!;

const mp4 = () => new File([new Uint8Array(10)], 'Fire exits.mp4', { type: 'video/mp4' });

function setup(start: UploadsValue['start'] = vi.fn(async () => undefined), category: CategoryConfig = VIDEOS) {
  mockSession(STAFF);
  const value: UploadsValue = { jobs: [], finishedCount: 0, start, resume: vi.fn(), retry: vi.fn(), cancel: vi.fn(), dismiss: vi.fn() };
  const onClose = vi.fn();
  const onStarted = vi.fn();
  renderWithSession(
    <UploadsContext.Provider value={value}>
      <UploadDialog open category={category} folderId="f1" onClose={onClose} onStarted={onStarted} />
    </UploadsContext.Provider>,
  );
  const dialog = screen.getByRole('dialog', { name: `Upload ${category.noun}` });
  return { dialog, start, onClose, onStarted };
}

const bigFile = () => {
  const file = new File(['x'], 'big.mp4', { type: 'video/mp4' });
  Object.defineProperty(file, 'size', { value: MAX_VIDEO_BYTES + 1 });
  return file;
};

describe('UploadDialog', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('fills in the title from the file name, without the extension, until the person types their own', async () => {
    const { dialog } = setup();
    await userEvent.upload(within(dialog).getByLabelText(/Video file/), mp4());
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Fire exits');
    await userEvent.clear(within(dialog).getByLabelText('Title'));
    await userEvent.type(within(dialog).getByLabelText('Title'), 'My own title');
    await userEvent.upload(within(dialog).getByLabelText(/Video file/), new File([new Uint8Array(5)], 'Other.mp4', { type: 'video/mp4' }));
    expect(within(dialog).getByLabelText('Title')).toHaveValue('My own title');
  });

  it('starts the upload with the trimmed title, the description, the length read from the file and the cover', async () => {
    const { dialog, start, onClose, onStarted } = setup();
    const file = mp4();
    const cover = new File(['png'], 'cover.png', { type: 'image/png' });
    await userEvent.upload(within(dialog).getByLabelText(/Video file/), file);
    const title = within(dialog).getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, '  Fire exits  ');
    await userEvent.type(within(dialog).getByLabelText('Description'), 'Where to go.');
    await userEvent.upload(within(dialog).getByLabelText('Cover image'), cover);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(start).toHaveBeenCalledWith({ file, folderId: 'f1', contentType: 'video/mp4', title: 'Fire exits', description: 'Where to go.', durationSeconds: 42, cover });
    await vi.waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('asks for a file and a title before sending anything', async () => {
    const { dialog, start } = setup();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(await within(dialog).findByText('Choose a video file.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a title.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Video file/)).toHaveFocus();
    expect(start).not.toHaveBeenCalled();
  });

  it('refuses a file that is not an MP4 and explains how to convert it', async () => {
    const { dialog, start } = setup();
    await userEvent.upload(within(dialog).getByLabelText(/Video file/), new File(['x'], 'clip.mov', { type: 'video/quicktime' }), { applyAccept: false });
    expect(await within(dialog).findByText(/HandBrake/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(start).not.toHaveBeenCalled();
  });

  it('refuses a file over 2 GB and an unsuitable cover', async () => {
    const { dialog, start } = setup();
    await userEvent.upload(within(dialog).getByLabelText(/Video file/), bigFile());
    expect(await within(dialog).findByText(/at most 2 GB/)).toBeInTheDocument();
    await userEvent.upload(within(dialog).getByLabelText('Cover image'), new File(['x'], 'c.gif', { type: 'image/gif' }), { applyAccept: false });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(await within(dialog).findByText('Choose a JPEG, PNG or WebP image.')).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
  });

  it('shows the server\'s refusal and stays open', async () => {
    const start = vi.fn(async () => {
      throw new ApiError(400, 'Validation failed', { title: ['Title must be 200 characters or fewer.'] });
    });
    const { dialog, onClose } = setup(start);
    await userEvent.upload(within(dialog).getByLabelText(/Video file/), mp4());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(await within(dialog).findByText('Title must be 200 characters or fewer.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows a general failure in an alert and stays open', async () => {
    const start = vi.fn(async () => {
      throw new ApiError(404, 'Folder not found.');
    });
    const { dialog } = setup(start);
    await userEvent.upload(within(dialog).getByLabelText(/Video file/), mp4());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Folder not found.');
  });

  it('does not open a file that will be refused in a video element', async () => {
    const { dialog } = setup();
    vi.mocked(readDuration).mockClear();
    await userEvent.upload(within(dialog).getByLabelText(/Video file/), bigFile());
    await within(dialog).findByText(/at most 2 GB/);
    expect(readDuration).not.toHaveBeenCalled();
  });


  it('reads the length of a video with a video element', async () => {
    const { dialog } = setup();
    vi.mocked(readDuration).mockClear();
    const file = mp4();
    await userEvent.upload(within(dialog).getByLabelText(/Video file/), file);
    expect(readDuration).toHaveBeenCalledWith(file, 'video');
  });
  it('cannot be dismissed or submitted twice while the server is accepting the upload', async () => {
    let accept: () => void = () => undefined;
    const start = vi.fn(() => new Promise<void>((resolve) => (accept = resolve)));
    const { dialog, onClose } = setup(start);
    await userEvent.upload(within(dialog).getByLabelText(/Video file/), mp4());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));

    expect(within(dialog).getByRole('button', { name: 'Start upload' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled();
    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    fireEvent.submit(dialog.querySelector('form') as HTMLFormElement);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(start).toHaveBeenCalledTimes(1);

    accept();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('UploadDialog for songs', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('offers MP3 and M4A up to 500 MB under the name of the category', () => {
    const { dialog } = setup(undefined, SONGS);
    expect(within(dialog).getByLabelText('Song file (MP3 or M4A, up to 500 MB)')).toHaveAttribute('accept', 'audio/mpeg,audio/mp4,.mp3,.m4a');
  });

  it('starts an MP3 with its type, reading its length with an audio element', async () => {
    const { dialog, start } = setup(undefined, SONGS);
    vi.mocked(readDuration).mockClear();
    const file = new File([new Uint8Array(10)], 'Morning song.mp3', { type: 'audio/mpeg' });
    await userEvent.upload(within(dialog).getByLabelText(/Song file/), file);
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Morning song');
    expect(readDuration).toHaveBeenCalledWith(file, 'audio');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith(expect.objectContaining({ file, folderId: 'f1', contentType: 'audio/mpeg', title: 'Morning song', durationSeconds: 42 })),
    );
  });

  it('declares an M4A that the system calls audio/x-m4a as audio/mp4', async () => {
    const { dialog, start } = setup(undefined, SONGS);
    const file = new File([new Uint8Array(10)], 'Talk.m4a', { type: 'audio/x-m4a' });
    await userEvent.upload(within(dialog).getByLabelText(/Song file/), file);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({ file, contentType: 'audio/mp4' })));
  });

  it('refuses raw AAC and video files with the audio message and sends nothing', async () => {
    const { dialog, start } = setup(undefined, SONGS);
    const input = within(dialog).getByLabelText(/Song file/);
    await userEvent.upload(input, new File(['x'], 'raw.aac', { type: 'audio/aac' }), { applyAccept: false });
    expect(await within(dialog).findByText('Only MP3 or M4A audio files can be uploaded here.')).toBeInTheDocument();
    await userEvent.upload(input, new File(['x'], 'clip.mp4', { type: 'video/mp4' }), { applyAccept: false });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(within(dialog).getByText('Only MP3 or M4A audio files can be uploaded here.')).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
  });

  it('refuses a song over 500 MB', async () => {
    const { dialog, start } = setup(undefined, SONGS);
    const big = new File(['x'], 'long.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(big, 'size', { value: MAX_AUDIO_BYTES + 1 });
    await userEvent.upload(within(dialog).getByLabelText(/Song file/), big);
    expect(await within(dialog).findByText('Audio files can be at most 500 MB. Choose a smaller file.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(start).not.toHaveBeenCalled();
  });

  it('asks for a song file before sending anything', async () => {
    const { dialog, start } = setup(undefined, SONGS);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start upload' }));
    expect(await within(dialog).findByText('Choose a song file.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Song file/)).toHaveFocus();
    expect(start).not.toHaveBeenCalled();
  });
});
