import { screen, waitFor, within } from '@testing-library/react';
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
    expect(await screen.findByRole('heading', { level: 1, name: heading }, { timeout: 5000 })).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(`/api/media${path}/folders`);
  });

  it('lists the courses on /courses', async () => {
    const fetchMock = mockSession(STAFF, (url) => (url === '/api/courses' ? { body: [] } : { status: 404, body: {} }));
    renderWithSession(<App />, '/courses');
    expect(await screen.findByRole('heading', { level: 1, name: 'Courses' }, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('/api/courses'));
  });

  it('opens a course on /courses/:courseId with the topic from the address', async () => {
    mockSession(STAFF, (url) => {
      if (url === '/api/courses/c1') return { body: { id: 'c1', title: 'Fire safety', description: null, position: 0, coverUrl: null, createdBy: { id: 'u1', name: 'Anita Rao' }, createdAt: '2026-10-09T10:00:00Z', lessons: [{ id: 'l1', title: 'Exits', position: 0, topics: [{ id: 't1', title: 'Fire exits', position: 0, attachmentCount: 0 }] }] } };
      if (url === '/api/topics/t1') return { body: { id: 't1', lessonId: 'l1', courseId: 'c1', title: 'Fire exits', description: null, position: 0, attachments: [] } };
      return { status: 404, body: {} };
    });
    renderWithSession(<App />, '/courses/c1?topic=t1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Fire safety' }, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Fire exits' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Courses' })).toHaveAttribute('href', '/courses');
  });

  it('opens a folder inside its category', async () => {
    mockSession(STAFF, (url) => {
      if (url === '/api/media/songs/folders') return { body: [{ id: 'f9', name: 'Road trip', position: 0, itemCount: 0, category: 'song' }] };
      if (url === '/api/media/folders/f9/items') return { body: [] };
      if (url === '/api/media/uploads/mine') return { body: [] };
      return { status: 404, body: {} };
    });
    renderWithSession(<App />, '/songs/f9');
    expect(await screen.findByRole('heading', { level: 1, name: 'Road trip' }, { timeout: 5000 })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Songs' })).toHaveAttribute('href', '/songs');
  });

  it('shows the not-found page for a category that does not exist', async () => {
    mockSession(STAFF);
    renderWithSession(<App />, '/music');
    expect(await screen.findByText('Page not found', {}, { timeout: 5000 })).toBeInTheDocument();
  });
});
