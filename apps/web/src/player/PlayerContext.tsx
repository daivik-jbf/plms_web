import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

export interface DockTrack {
  itemId: string;
  title: string;
  categoryLabel: string;
  folderName: string;
  coverUrl: string | null;
}

// One start of playback. Every Play is a new session, even for the same item: it starts again with a fresh link.
export interface PlayerSession {
  id: number;
  track: DockTrack;
}

export interface PlayerValue {
  session: PlayerSession | null;
  play: (track: DockTrack) => void;
  close: () => void;
}

export const PlayerContext = createContext<PlayerValue | null>(null);

export function usePlayer(): PlayerValue {
  const value = useContext(PlayerContext);
  if (!value) throw new Error('usePlayer must be used inside PlayerProvider');
  return value;
}

// Lives inside the app shell, so the sound keeps playing while the person browses and stops when they sign out.
// Memory only: a page reload stops playback, and no link is ever stored.
export function PlayerProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PlayerSession | null>(null);
  const play = useCallback((track: DockTrack) => setSession((previous) => ({ id: (previous?.id ?? 0) + 1, track })), []);
  const close = useCallback(() => setSession(null), []);
  const value = useMemo(() => ({ session, play, close }), [session, play, close]);
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
