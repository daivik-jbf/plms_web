import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { mockSession, renderWithSession, STAFF } from './test/session';

describe('App routes for the media categories', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it.each([
    ['/videos', 'Videos'],
    ['/movies', 'Movies'],
    ['/podcasts', 'Podcasts'],
    ['/songs', 'Songs'],
  ])("%s lists that category's folders", async (path, heading) => {
    const fetchMock = mockSession(STAFF, (url) => (url === `/api/media${path}/folders` ? { body: [] } : { status: 404, body: {} }));
    renderWithSession(<App />, path);
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(`/api/media${path}/folders`);
  });

  it('opens a folder inside its category', async () => {
    mockSession(STAFF, (url) => {
      if (url === '/api/media/songs/folders') return { body: [{ id: 'f9', name: 'Road trip', position: 0, itemCount: 0, category: 'song' }] };
      if (url === '/api/media/folders/f9/items') return { body: [] };
      if (url === '/api/media/uploads/mine') return { body: [] };
      return { status: 404, body: {} };
    });
    renderWithSession(<App />, '/songs/f9');
    expect(await screen.findByRole('heading', { level: 1, name: 'Road trip' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Songs' })).toHaveAttribute('href', '/songs');
  });

  it('shows the not-found page for a category that does not exist', async () => {
    mockSession(STAFF);
    renderWithSession(<App />, '/music');
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
  });
});
