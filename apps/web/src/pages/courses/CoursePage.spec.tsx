import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CourseTree, TopicView } from '../../api/courses';
import type { MockResponse } from '../../test/fetch-mock';
import { LocationProbe, mockSession, renderWithSession, STAFF } from '../../test/session';
import { CoursePage } from './CoursePage';
import styles from './Courses.module.css';

const tree: CourseTree = {
  id: 'c1',
  title: 'Fire safety',
  description: 'Know the exits.\nPractise them.',
  position: 0,
  coverUrl: 'https://cdn.example/cover?sig=1',
  createdBy: { id: 'u1', name: 'Anita Rao' },
  createdAt: '2026-10-09T10:00:00Z',
  lessons: [
    {
      id: 'l1',
      title: 'Exits',
      position: 0,
      topics: [
        { id: 't1', title: 'Fire exits', position: 0, attachmentCount: 2 },
        { id: 't2', title: '<b>Alarms</b>', position: 1, attachmentCount: 0 },
      ],
    },
    { id: 'l2', title: 'Equipment', position: 1, topics: [] },
  ],
};

const topic = (overrides: Partial<TopicView> & { id: string; title: string }): TopicView => ({
  lessonId: 'l1',
  courseId: 'c1',
  description: null,
  position: 0,
  ...overrides,
});
const topicsFixture: Record<string, TopicView> = {
  t1: topic({ id: 't1', title: 'Fire exits', description: 'Keep them clear.\nNever lock them.' }),
  t2: topic({ id: 't2', title: '<b>Alarms</b>', position: 1, description: '<script>alert(1)</script>' }),
};

type Override = MockResponse | ((body: Record<string, unknown>) => MockResponse);

function startServer(overrides: Record<string, Override> = {}, course: CourseTree = tree) {
  const state = { course: structuredClone(course) };
  const calls: { key: string; body: Record<string, unknown> }[] = [];
  mockSession(STAFF, (url, init) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ key, body });
    const override = overrides[key];
    if (override) return typeof override === 'function' ? override(body) : override;
    if (key === 'GET /api/courses/c1') return { body: state.course };
    const found = /^GET \/api\/topics\/([^/]+)$/.exec(key);
    if (found) return topicsFixture[found[1] as string] ? { body: topicsFixture[found[1] as string] } : { status: 404, body: { message: 'Topic not found.' } };
    if (key === 'PATCH /api/courses/c1') {
      Object.assign(state.course, body);
      return { body: state.course };
    }
    return { status: 404, body: {} };
  });
  return calls;
}

function renderPage(route = '/courses/c1') {
  return renderWithSession(
    <>
      <Routes>
        <Route path="/courses/:courseId" element={<CoursePage />} />
        <Route path="/courses" element={<p>The course list</p>} />
      </Routes>
      <LocationProbe />
    </>,
    route,
  );
}

describe('CoursePage', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('shows a loading state, then the course with its cover, text, breadcrumb and tree', async () => {
    startServer();
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1, name: 'Fire safety' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Courses' })).toHaveAttribute('href', '/courses');
    expect(document.querySelector('img')).toHaveAttribute('src', 'https://cdn.example/cover?sig=1');
    expect(screen.getByText(/Know the exits\./).textContent).toBe('Know the exits.\nPractise them.');
    expect(screen.getByRole('tree', { name: 'Course contents' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'Exits' })).toBeInTheDocument();
  });

  it('asks for a topic when none is chosen and shows no topic request', async () => {
    const calls = startServer();
    renderPage();
    expect(await screen.findByText('Choose a topic')).toBeInTheDocument();
    expect(calls.some((call) => call.key.startsWith('GET /api/topics'))).toBe(false);
  });

  it('opens the topic in the address when the page is opened with ?topic=, selects it in the tree and shows its text as plain lines', async () => {
    startServer();
    renderPage('/courses/c1?topic=t1');
    expect(await screen.findByRole('heading', { level: 2, name: 'Fire exits' })).toBeInTheDocument();
    expect(screen.getByText(/Keep them clear\./).textContent).toBe('Keep them clear.\nNever lock them.');
    expect(screen.getByRole('treeitem', { name: 'Fire exits' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows another topic when it is chosen in the tree, and keeps the choice in the address', async () => {
    const calls = startServer();
    renderPage('/courses/c1?topic=t1');
    await screen.findByRole('heading', { level: 2, name: 'Fire exits' });
    await userEvent.click(within(screen.getByRole('treeitem', { name: '<b>Alarms</b>' })).getByText('<b>Alarms</b>'));
    expect(await screen.findByRole('heading', { level: 2, name: '<b>Alarms</b>' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/courses/c1?topic=t2');
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(document.querySelector('script, b')).toBeNull();
    expect(calls.filter((call) => call.key === 'GET /api/topics/t2')).toHaveLength(1);
  });

  it('says so for a topic that is not in the course and for one the server no longer has', async () => {
    startServer();
    renderPage('/courses/c1?topic=nope');
    expect(await screen.findByText('Topic not found')).toBeInTheDocument();
  });

  it('says so when the server has no such topic although the tree lists it', async () => {
    startServer({ 'GET /api/topics/t1': { status: 404, body: { message: 'Topic not found.' } } });
    renderPage('/courses/c1?topic=t1');
    expect(await screen.findByText('Topic not found')).toBeInTheDocument();
  });

  it('offers Retry when the topic cannot be loaded', async () => {
    let fail = true;
    startServer({ 'GET /api/topics/t1': () => (fail ? { status: 500, body: {} } : { body: topicsFixture.t1 }) });
    renderPage('/courses/c1?topic=t1');
    const panel = await screen.findByRole('region', { name: 'Selected topic' });
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Something went wrong');
    fail = false;
    await userEvent.click(within(panel).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Fire exits' })).toBeInTheDocument();
  });

  it('tells a phone which pane to show and has a Back button that clears the topic', async () => {
    startServer();
    renderPage('/courses/c1?topic=t1');
    await screen.findByRole('heading', { level: 2, name: 'Fire exits' });
    const panes = document.querySelector(`.${styles.panes}`) as HTMLElement;
    expect(panes).toHaveAttribute('data-view', 'topic');
    await userEvent.click(screen.getByRole('button', { name: 'Back to the course' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/courses\/c1$/);
    expect(panes).toHaveAttribute('data-view', 'tree');
    expect(screen.queryByRole('button', { name: 'Back to the course' })).toBeNull();
    expect(screen.getByText('Choose a topic')).toBeInTheDocument();
  });

  it('shows an empty state for a course without lessons', async () => {
    startServer({}, { ...tree, lessons: [], description: null, coverUrl: null });
    renderPage();
    expect(await screen.findByText('No lessons yet')).toBeInTheDocument();
    expect(screen.queryByRole('tree')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
  });

  it('offers Retry when the course cannot be loaded', async () => {
    let fail = true;
    startServer({ 'GET /api/courses/c1': () => (fail ? { status: 500, body: {} } : { body: tree }) });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Fire safety' })).toBeInTheDocument();
  });

  it('says so, with a way back, for a course that does not exist', async () => {
    startServer({ 'GET /api/courses/c1': { status: 404, body: { message: 'Course not found.' } } });
    renderPage();
    expect(await screen.findByText('Course not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Courses' })).toHaveAttribute('href', '/courses');
  });

  describe('editing the course', () => {
    it('starts from the current text and sends only what changed', async () => {
      const calls = startServer();
      renderPage();
      await userEvent.click(await screen.findByRole('button', { name: 'Edit course' }));
      const dialog = screen.getByRole('dialog', { name: 'Edit course' });
      expect(within(dialog).getByLabelText('Course title')).toHaveValue('Fire safety');
      expect(within(dialog).getByLabelText('Description')).toHaveValue('Know the exits.\nPractise them.');
      const title = within(dialog).getByLabelText('Course title');
      await userEvent.clear(title);
      await userEvent.type(title, '  Fire and exits ');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit course' })).toBeNull());
      expect(calls.find((call) => call.key === 'PATCH /api/courses/c1')?.body).toEqual({ title: 'Fire and exits' });
      expect(await screen.findByRole('heading', { level: 1, name: 'Fire and exits' })).toBeInTheDocument();
    });

    it('clears the description with an empty one', async () => {
      const calls = startServer();
      renderPage();
      await userEvent.click(await screen.findByRole('button', { name: 'Edit course' }));
      await userEvent.clear(screen.getByLabelText('Description'));
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit course' })).toBeNull());
      expect(calls.find((call) => call.key === 'PATCH /api/courses/c1')?.body).toEqual({ description: '' });
    });

    it('asks for a title, and checks the cover before sending anything', async () => {
      const calls = startServer();
      renderPage();
      await userEvent.click(await screen.findByRole('button', { name: 'Edit course' }));
      await userEvent.clear(screen.getByLabelText('Course title'));
      await userEvent.upload(screen.getByLabelText('Cover image'), new File(['x'], 'notes.txt', { type: 'text/plain' }), { applyAccept: false });
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByText('Enter a course title.')).toBeInTheDocument();
      expect(screen.getByText('Choose a JPEG, PNG or WebP image.')).toBeInTheDocument();
      expect(calls.some((call) => call.key.startsWith('PATCH'))).toBe(false);
    });

    it('sends a new cover in three steps and reloads the course', async () => {
      const calls = startServer({
        'POST /api/courses/c1/cover': { status: 201, body: { fileId: 'f9', url: 'https://storage.example/put?sig=1', headers: { 'Content-Type': 'image/png' } } },
        'PUT https://storage.example/put?sig=1': { status: 200, body: {} },
        'POST /api/courses/c1/cover/f9/complete': { body: { ...tree, coverUrl: 'https://cdn.example/new?sig=2' } },
      });
      renderPage();
      await userEvent.click(await screen.findByRole('button', { name: 'Edit course' }));
      await userEvent.upload(screen.getByLabelText('Cover image'), new File(['x'], 'cover.png', { type: 'image/png' }));
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit course' })).toBeNull());
      expect(calls.map((call) => call.key).filter((key) => /cover|storage/.test(key))).toEqual([
        'POST /api/courses/c1/cover',
        'PUT https://storage.example/put?sig=1',
        'POST /api/courses/c1/cover/f9/complete',
      ]);
      expect(calls.some((call) => call.key === 'PATCH /api/courses/c1')).toBe(false);
    });

    it('keeps what was saved and says the cover failed when only the cover goes wrong', async () => {
      startServer({ 'POST /api/courses/c1/cover': { status: 500, body: {} } });
      renderPage();
      await userEvent.click(await screen.findByRole('button', { name: 'Edit course' }));
      const title = screen.getByLabelText('Course title');
      await userEvent.clear(title);
      await userEvent.type(title, 'Fire and exits');
      await userEvent.upload(screen.getByLabelText('Cover image'), new File(['x'], 'cover.png', { type: 'image/png' }));
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByText(/Your changes were saved, but the cover image could not be added/)).toBeInTheDocument();
      expect(await screen.findByRole('heading', { level: 1, name: 'Fire and exits' })).toBeInTheDocument();
    });

    it('shows what the server says about the title and keeps the dialog open', async () => {
      startServer({ 'PATCH /api/courses/c1': { status: 400, body: { message: 'Validation failed', fieldErrors: { title: ['Title must be 200 characters or fewer.'] } } } });
      renderPage();
      await userEvent.click(await screen.findByRole('button', { name: 'Edit course' }));
      const title = screen.getByLabelText('Course title');
      await userEvent.clear(title);
      await userEvent.type(title, 'Changed');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByText('Title must be 200 characters or fewer.')).toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Edit course' })).toBeInTheDocument();
    });
  });
});
