import type { CategorySlug } from '../api/media';
import type { MediaKind } from '../uploads/limits';

export interface CategoryConfig {
  slug: CategorySlug;
  kind: MediaKind;
  // The words the pages use: "Songs" (headings, links, the count column), "song" and "songs" (sentences),
  // "Song" (table names and the first column).
  label: string;
  noun: string;
  nounPlural: string;
  nounTitle: string;
}

// The four media categories, in sidebar order: the web copy of the server's table (apps/api/src/media/media-kinds.ts).
// The kind decides the file rules (uploads/limits.ts) and the player: the pop-up for video, the docked player for audio.
export const CATEGORIES: readonly CategoryConfig[] = [
  { slug: 'videos', kind: 'video', label: 'Videos', noun: 'video', nounPlural: 'videos', nounTitle: 'Video' },
  { slug: 'movies', kind: 'video', label: 'Movies', noun: 'movie', nounPlural: 'movies', nounTitle: 'Movie' },
  { slug: 'podcasts', kind: 'audio', label: 'Podcasts', noun: 'podcast', nounPlural: 'podcasts', nounTitle: 'Podcast' },
  { slug: 'songs', kind: 'audio', label: 'Songs', noun: 'song', nounPlural: 'songs', nounTitle: 'Song' },
];
