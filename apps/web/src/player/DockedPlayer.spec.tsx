import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import type { MockResponse } from '../test/fetch-mock';
import { mockSession, renderWithSession, STAFF } from '../test/session';
import { DockedPlayer } from './DockedPlayer';
import styles from './DockedPlayer.module.css';
import { type DockTrack, PlayerProvider, usePlayer } from './PlayerContext';

const song: DockTrack = { itemId: 's1', title: 'Morning song', categoryLabel: 'Songs', folderName: 'Road trip', coverUrl: null };
const podcast: DockTrack = { itemId: 'p1', title: 'Episode 4', categoryLabel: 'Podcasts', folderName: 'Weekly', coverUrl: 'https://cdn.example/cover?sig=1' };
const FAILED = 'This could not be played. Please try again later.';

let player: ReturnType<typeof usePlayer>;
function Probe() {
  player = usePlayer();
  return null;
}

// Answers every playback link request with a new link (s1-1, s1-2, ...) unless `refuse` says otherwise.
function startServer(refuse: (count: number) => MockResponse | null = () => null) {
  const requests: string[] = [];
  mockSession(STAFF, (url, init) => {
    const match = /^\/api\/media\/items\/([^/]+)\/play$/.exec(url);
    if (!match || init.method !== 'POST') return { status: 404, body: {} };
    requests.push(match[1] as string);
    const refused = refuse(requests.length);
    if (refused) return refused;
    return { body: { url: `https://cdn.example/${match[1]}-${requests.length}?sig=1`, expiresAt: '2026-10-09T11:00:00Z', contentType: 'audio/mpeg' } };
  });
  return requests;
}

function renderDock(strict = false) {
  const tree = (
    <PlayerProvider>
      <Probe />
      <DockedPlayer />
    </PlayerProvider>
  );
  return renderWithSession(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

const audio = () => document.querySelector('audio') as HTMLAudioElement;
const setDuration = (element: HTMLMediaElement, value: number) => Object.defineProperty(element, 'duration', { configurable: true, value });

async function start(track: DockTrack, expectedSrc: string) {
  act(() => player.play(track));
  await waitFor(() => expect(audio()).toHaveAttribute('src', expectedSrc));
}

describe('DockedPlayer', () => {
  let play: MockInstance<() => Promise<void>>;
  let pause: MockInstance<() => void>;

  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // jsdom has no media playback: play() and pause() are stand-ins that only record their calls.
    play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    localStorage.clear();
    sessionStorage.clear();
  });

  it('shows nothing until something plays', () => {
    startServer();
    renderDock();
    expect(screen.queryByRole('region', { name: 'Player' })).toBeNull();
    expect(document.querySelector('audio')).toBeNull();
  });

  it('plays a chosen track with one link, showing its title and "Category › Folder"', async () => {
    const requests = startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    const bar = screen.getByRole('region', { name: 'Player' });
    expect(within(bar).getByText('Morning song')).toBeInTheDocument();
    expect(within(bar).getByText('Songs › Road trip')).toBeInTheDocument();
    expect(within(bar).getByText('♪')).toHaveAttribute('aria-hidden', 'true');
    expect(audio()).toHaveAttribute('autoplay');
    expect(requests).toEqual(['s1']);
    fireEvent.play(audio());
    expect(within(bar).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('shows Play when the browser blocks autoplay, and Play starts it', async () => {
    startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    const button = screen.getByRole('button', { name: 'Play' });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(play.mock.contexts).toEqual([audio()]);
  });

  it('pauses and plays again with the same button', async () => {
    startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    fireEvent.play(audio());
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(pause.mock.contexts).toEqual([audio()]);
    fireEvent.pause(audio());
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('shows the times and seeks with the slider (a native range input, so arrow keys work in browsers)', async () => {
    startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    const seek = screen.getByRole('slider', { name: 'Seek' });
    expect(seek).toBeDisabled();
    setDuration(audio(), 200);
    fireEvent.loadedMetadata(audio());
    expect(seek).toBeEnabled();
    expect(seek).toHaveAttribute('type', 'range');
    expect(seek).toHaveAttribute('max', '200');
    expect(seek).toHaveAttribute('step', '1');
    expect(screen.getByText('3:20')).toBeInTheDocument();
    audio().currentTime = 30;
    fireEvent.timeUpdate(audio());
    expect(screen.getByText('0:30')).toBeInTheDocument();
    fireEvent.change(seek, { target: { value: '65' } });
    expect(audio().currentTime).toBe(65);
    expect(screen.getByText('1:05')).toBeInTheDocument();
    expect(seek).toHaveAttribute('aria-valuetext', '1:05 of 3:20');
  });

  it.each([Number.POSITIVE_INFINITY, Number.NaN, 0])('leaves the slider disabled with a dash for a length of %s', async (value) => {
    startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    setDuration(audio(), value);
    fireEvent.loadedMetadata(audio());
    expect(screen.getByRole('slider', { name: 'Seek' })).toBeDisabled();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('changes the volume and mutes and unmutes', async () => {
    startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    const volume = screen.getByRole('slider', { name: 'Volume' });
    fireEvent.change(volume, { target: { value: '0.4' } });
    expect(audio().volume).toBe(0.4);
    await waitFor(() => expect(volume).toHaveValue('0.4'));
    const mute = screen.getByRole('button', { name: 'Mute' });
    await userEvent.click(mute);
    expect(audio().muted).toBe(true);
    await waitFor(() => expect(mute).toHaveAttribute('aria-pressed', 'true'));
    expect(volume).toHaveValue('0');
    await userEvent.click(mute);
    await waitFor(() => expect(mute).toHaveAttribute('aria-pressed', 'false'));
    expect(volume).toHaveValue('0.4');
  });

  it('stays on a finished track, back at the start, and Play replays it without a new link', async () => {
    const requests = startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    setDuration(audio(), 200);
    fireEvent.loadedMetadata(audio());
    fireEvent.play(audio());
    audio().currentTime = 200;
    fireEvent.timeUpdate(audio());
    expect(screen.getAllByText('3:20')).toHaveLength(2);
    fireEvent.pause(audio());
    fireEvent.ended(audio());
    expect(screen.getByRole('region', { name: 'Player' })).toHaveTextContent('Morning song');
    expect(audio().currentTime).toBe(0);
    expect(screen.getByText('0:00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(requests).toEqual(['s1']);
  });

  it('replaces the track when another is chosen, stopping the first', async () => {
    const requests = startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    const first = audio();
    await start(podcast, 'https://cdn.example/p1-2?sig=1');
    expect(document.querySelectorAll('audio')).toHaveLength(1);
    expect(audio()).not.toBe(first);
    expect(pause.mock.contexts).toContain(first);
    const bar = screen.getByRole('region', { name: 'Player' });
    expect(within(bar).getByText('Episode 4')).toBeInTheDocument();
    expect(within(bar).getByText('Podcasts › Weekly')).toBeInTheDocument();
    expect(bar.querySelector('img')).toHaveAttribute('src', 'https://cdn.example/cover?sig=1');
    expect(bar.querySelector('img')).toHaveAttribute('alt', '');
    expect(requests).toEqual(['s1', 'p1']);
  });

  it('asks once for a fresh link when the audio stops loading and carries on from the same position', async () => {
    const requests = startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    audio().currentTime = 42.5;
    fireEvent.error(audio());
    await waitFor(() => expect(audio()).toHaveAttribute('src', 'https://cdn.example/s1-2?sig=1'));
    expect(requests).toEqual(['s1', 's1']);
    // The browser starts from the beginning when a new source loads.
    audio().currentTime = 0;
    setDuration(audio(), 200);
    play.mockClear();
    fireEvent.loadedMetadata(audio());
    expect(audio().currentTime).toBe(42.5);
    expect(play).toHaveBeenCalledTimes(1);
    // The position is used once.
    fireEvent.loadedMetadata(audio());
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('gives up after a second failure with a message and Try again, which asks for a new link', async () => {
    const requests = startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    fireEvent.error(audio());
    await waitFor(() => expect(audio()).toHaveAttribute('src', 'https://cdn.example/s1-2?sig=1'));
    fireEvent.error(audio());
    expect(await screen.findByRole('alert')).toHaveTextContent(FAILED);
    expect(audio()).not.toHaveAttribute('src');
    expect(requests).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(audio()).toHaveAttribute('src', 'https://cdn.example/s1-3?sig=1'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('allows another fresh link once the audio has played again', async () => {
    const requests = startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    fireEvent.error(audio());
    await waitFor(() => expect(audio()).toHaveAttribute('src', 'https://cdn.example/s1-2?sig=1'));
    fireEvent.playing(audio());
    fireEvent.error(audio());
    await waitFor(() => expect(audio()).toHaveAttribute('src', 'https://cdn.example/s1-3?sig=1'));
    expect(requests).toHaveLength(3);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the server refusal with Try again when no link is given', async () => {
    startServer((count) => (count === 1 ? { status: 409, body: { message: 'This is still uploading.' } } : null));
    renderDock();
    act(() => player.play(song));
    expect(await screen.findByRole('alert')).toHaveTextContent('This is still uploading.');
    expect(audio()).not.toHaveAttribute('src');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(audio()).toHaveAttribute('src', 'https://cdn.example/s1-2?sig=1'));
  });

  it('asks for one link per start even when effects run twice (development double-run)', async () => {
    const requests = startServer();
    renderDock(true);
    await start(song, 'https://cdn.example/s1-1?sig=1');
    expect(requests).toEqual(['s1']);
    await start(podcast, 'https://cdn.example/p1-2?sig=1');
    expect(requests).toEqual(['s1', 'p1']);
  });

  it('Close stops the sound and removes the player', async () => {
    startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    const element = audio();
    await userEvent.click(screen.getByRole('button', { name: 'Close player' }));
    expect(screen.queryByRole('region', { name: 'Player' })).toBeNull();
    expect(document.querySelector('audio')).toBeNull();
    expect(pause.mock.contexts).toContain(element);
  });

  it('shows a hostile title as plain text and stores no link', async () => {
    startServer();
    renderDock();
    await start({ ...song, title: '<img src=x onerror=alert(1)>' }, 'https://cdn.example/s1-1?sig=1');
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('lays the bar out in areas the phone layout rearranges into two rows', async () => {
    startServer();
    renderDock();
    await start(song, 'https://cdn.example/s1-1?sig=1');
    expect(screen.getByText('Morning song').closest(`.${styles.info}`)).not.toBeNull();
    expect(screen.getByRole('slider', { name: 'Seek' }).closest(`.${styles.transport}`)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Play' }).closest(`.${styles.transport}`)).not.toBeNull();
    expect(screen.getByRole('slider', { name: 'Volume' }).closest(`.${styles.volume}`)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Close player' }).closest(`.${styles.close}`)).not.toBeNull();
  });
});
