import type { Folder } from '../api/media';

const WHEN = '2026-10-12T09:30:00.000Z';

// A folder as the API returns it; a test names only what it cares about.
export const makeFolder = (overrides: Partial<Folder> & Pick<Folder, 'id' | 'name'>): Folder => ({
  position: 0,
  itemCount: 0,
  sizeBytes: 0,
  category: 'video',
  createdAt: WHEN,
  createdBy: { id: 'u1', name: 'Anita' },
  updatedAt: WHEN,
  updatedBy: { id: 'u1', name: 'Anita' },
  ...overrides,
});
