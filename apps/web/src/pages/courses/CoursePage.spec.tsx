import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CourseTree, TopicDetail } from '../../api/courses';
import { PlayerProvider } from '../../player/PlayerContext';
import { UploadsProvider } from '../../uploads/UploadsContext';
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

const topic = (overrides: Partial<TopicDetail> & { id: string; title: string }): TopicDetail => ({
  lessonId: 'l1',
  courseId: 'c1',
  description: null,
  position: 0,
  attachments: [],
  ...overrides,
});
const topicsFixture: Record<string, TopicDetail> = {
  t1: topic({ id: 't1', title: 'Fire exits', description: 'Keep them clear.\nNever lock them.' }),
  t2: topic({ id: 't2', title: '<b>Alarms</b>', position: 1, description: '<script>alert(1)</script>' }),
};

type Override = MockResponse | ((body: Record<string, unknown>) => MockResponse);

function startServer(overrides: Record<string, Override> = {}, course: CourseTree = tree) {
  const state = { course: structuredClone(course), topics: structuredClone(topicsFixture), added: 0 };
  const calls: { key: string; body: Record<string, unknown> }[] = [];
  mockSession(STAFF, (url, init) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ key, body });
    const override = overrides[key];
    if (override) return typeof override === 'function' ? override(body) : override;
    if (key === 'GET /api/courses/c1') return { body: state.course };
    const found = /^GET \/api\/topics\/([^/]+)$/.exec(key);
    if (found) return state.topics[found[1] as string] ? { body: state.topics[found[1] as string] } : { status: 404, body: { message: 'Topic not found.' } };
    const lessonOf = (id: string) => state.course.lessons.find((lesson) => lesson.id === id)!;
    if (key === 'POST /api/courses/c1/lessons') {
      state.added += 1;
      state.course.lessons.push({ id: `l-new-${state.added}`, title: String(body.title), position: state.course.lessons.length, topics: [] });
      return { status: 201, body: state.course };
    }
    const renameLesson = /^PATCH \/api\/lessons\/([^/]+)$/.exec(key);
    if (renameLesson) {
      lessonOf(renameLesson[1] as string).title = String(body.title);
      return { body: state.course };
    }
    if (key === 'PUT /api/courses/c1/lessons/order') {
      state.course.lessons = (body.ids as string[]).map((id, index) => ({ ...lessonOf(id), position: index }));
      return { body: state.course };
    }
    const addTopic = /^POST \/api\/lessons\/([^/]+)\/topics$/.exec(key);
    if (addTopic) {
      state.added += 1;
      const lesson = lessonOf(addTopic[1] as string);
      lesson.topics.push({ id: `t-new-${state.added}`, title: String(body.title), position: lesson.topics.length, attachmentCount: 0 });
      return { status: 201, body: state.course };
    }
    const reorderTopics = /^PUT \/api\/lessons\/([^/]+)\/topics\/order$/.exec(key);
    if (reorderTopics) {
      const lesson = lessonOf(reorderTopics[1] as string);
      lesson.topics = (body.ids as string[]).map((id, index) => ({ ...lesson.topics.find((candidate) => candidate.id === id)!, position: index }));
      return { body: state.course };
    }
    const editTopic = /^PATCH \/api\/topics\/([^/]+)$/.exec(key);
    if (editTopic) {
      const id = editTopic[1] as string;
      Object.assign(state.topics[id]!, body);
      if (typeof body.title === 'string') for (const lesson of state.course.lessons) for (const entry of lesson.topics) if (entry.id === id) entry.title = body.title;
      return { body: state.topics[id] };
    }
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
    <UploadsProvider>
      <PlayerProvider>
        <Routes>
          <Route path="/courses/:courseId" element={<CoursePage />} />
          <Route path="/courses" element={<p>The course list</p>} />
        </Routes>
        <LocationProbe />
      </PlayerProvider>
    </UploadsProvider>,
    route,
  );
}

describe('CoursePage', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('has a Back to Courses button in the banner that returns to the list with this course chosen', async () => {
    startServer();
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Fire safety' });
    expect(screen.getByRole('link', { name: 'Back to Courses' })).toHaveAttribute('href', '/courses?course=c1');
  });

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

  describe('on a phone, where one pane is shown at a time', () => {
    const phone = (matches: boolean) =>
      vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));

    it('moves the keyboard to the topic when one is chosen, and back to it in the list when Back is pressed', async () => {
      phone(true);
      startServer();
      renderPage();
      const item = await screen.findByRole('treeitem', { name: 'Fire exits' });
      item.focus();
      await userEvent.keyboard('{Enter}');
      await screen.findByRole('heading', { level: 2, name: 'Fire exits' });
      expect(screen.getByRole('button', { name: 'Back to the course' })).toHaveFocus();
      await userEvent.keyboard('{Enter}');
      expect(screen.getByRole('treeitem', { name: 'Fire exits' })).toHaveFocus();
    });

    it('leaves the keyboard alone where both panes are shown, and when a topic is already open on arrival', async () => {
      phone(false);
      startServer();
      renderPage();
      const item = await screen.findByRole('treeitem', { name: 'Fire exits' });
      item.focus();
      await userEvent.keyboard('{Enter}');
      await screen.findByRole('heading', { level: 2, name: 'Fire exits' });
      expect(item).toHaveFocus();
      cleanup();
      phone(true);
      renderPage('/courses/c1?topic=t1');
      await screen.findByRole('heading', { level: 2, name: 'Fire exits' });
      expect(screen.getByRole('button', { name: 'Back to the course' })).not.toHaveFocus();
    });
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

describe('CoursePage: building the course', () => {
  beforeEach(() => vi.unstubAllGlobals());

  const lessonsInTree = () => within(screen.getByRole('tree', { name: 'Course contents' })).getAllByRole('treeitem').filter((item) => item.getAttribute('aria-level') === '1');

  it('adds a lesson from a dialog and shows it at the end of the tree', async () => {
    const calls = startServer();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add lesson' }));
    const dialog = screen.getByRole('dialog', { name: 'Add lesson' });
    await userEvent.type(within(dialog).getByLabelText('Lesson title'), '  Alarms and drills ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add lesson' }));
    expect(await screen.findByText('Lesson "Alarms and drills" added.')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'POST /api/courses/c1/lessons')?.body).toEqual({ title: 'Alarms and drills' });
    expect(lessonsInTree().map((item) => item.getAttribute('aria-label'))).toEqual(['Exits', 'Equipment', 'Alarms and drills']);
    expect(screen.queryByRole('dialog', { name: 'Add lesson' })).toBeNull();
  });

  it('offers Add lesson in an empty course too', async () => {
    startServer({}, { ...tree, lessons: [] });
    renderPage();
    expect(await screen.findByText('No lessons yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add lesson' })).toBeInTheDocument();
  });

  it('asks for a title before sending anything', async () => {
    const calls = startServer();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add lesson' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Add lesson' })).getByRole('button', { name: 'Add lesson' }));
    expect(await screen.findByText('Enter a lesson title.')).toBeInTheDocument();
    expect(screen.getByLabelText('Lesson title')).toHaveFocus();
    expect(calls.some((call) => call.key.startsWith('POST'))).toBe(false);
  });

  it('shows what the server says about the title and keeps the dialog open', async () => {
    startServer({ 'POST /api/courses/c1/lessons': { status: 400, body: { message: 'Validation failed', fieldErrors: { title: ['Title must be 200 characters or fewer.'] } } } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add lesson' }));
    await userEvent.type(screen.getByLabelText('Lesson title'), 'Long');
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Add lesson' })).getByRole('button', { name: 'Add lesson' }));
    expect(await screen.findByText('Title must be 200 characters or fewer.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Add lesson' })).toBeInTheDocument();
  });

  it('shows a failure that is not about the title as an alert and keeps the dialog open', async () => {
    startServer({ 'POST /api/courses/c1/lessons': { status: 500, body: {} } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add lesson' }));
    await userEvent.type(screen.getByLabelText('Lesson title'), 'Alarms');
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Add lesson' })).getByRole('button', { name: 'Add lesson' }));
    expect(await within(screen.getByRole('dialog', { name: 'Add lesson' })).findByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('cannot be dismissed while a title is being sent', async () => {
    let release: (value: MockResponse) => void = () => undefined;
    const pending = new Promise<MockResponse>((resolve) => (release = resolve));
    startServer({ 'POST /api/courses/c1/lessons': () => pending as unknown as MockResponse });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add lesson' }));
    await userEvent.type(screen.getByLabelText('Lesson title'), 'Slow');
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Add lesson' })).getByRole('button', { name: 'Add lesson' }));
    const dialog = screen.getByRole('dialog', { name: 'Add lesson' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled());
    release({ status: 201, body: { ...tree, lessons: [...tree.lessons, { id: 'l-slow', title: 'Slow', position: 2, topics: [] }] } });
    expect(await screen.findByText('Lesson "Slow" added.')).toBeInTheDocument();
  });

  it('renames a lesson, starting from its current title', async () => {
    const calls = startServer();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Rename lesson Equipment' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename lesson' });
    const field = within(dialog).getByLabelText('Lesson title');
    expect(field).toHaveValue('Equipment');
    await userEvent.clear(field);
    await userEvent.type(field, 'Kit');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Lesson renamed to "Kit".')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'PATCH /api/lessons/l2')?.body).toEqual({ title: 'Kit' });
    expect(screen.getByRole('treeitem', { name: 'Kit' })).toBeInTheDocument();
  });

  it('adds a topic to a lesson and shows it in that lesson', async () => {
    const calls = startServer();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add a topic to Equipment' }));
    const dialog = screen.getByRole('dialog', { name: 'Add topic' });
    await userEvent.type(within(dialog).getByLabelText('Topic title'), 'Extinguishers');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add topic' }));
    expect(await screen.findByText('Topic "Extinguishers" added.')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'POST /api/lessons/l2/topics')?.body).toEqual({ title: 'Extinguishers' });
    expect(within(screen.getByRole('treeitem', { name: 'Equipment' })).getByRole('treeitem', { name: 'Extinguishers' })).toBeInTheDocument();
  });

  it('adds a topic with a description, and sends it with the title', async () => {
    const calls = startServer();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add a topic to Equipment' }));
    const dialog = screen.getByRole('dialog', { name: 'Add topic' });
    await userEvent.type(within(dialog).getByLabelText('Topic title'), 'Extinguishers');
    await userEvent.type(within(dialog).getByLabelText('Description'), '  Types and uses.  ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add topic' }));
    expect(await screen.findByText('Topic "Extinguishers" added.')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'POST /api/lessons/l2/topics')?.body).toEqual({ title: 'Extinguishers', description: 'Types and uses.' });
  });

  it('edits the open topic from its row in the tree and updates the open topic panel', async () => {
    const calls = startServer();
    renderPage('/courses/c1?topic=t1');
    await screen.findByRole('heading', { level: 2, name: 'Fire exits' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit topic Fire exits' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit topic' });
    const field = within(dialog).getByLabelText('Topic title');
    expect(field).toHaveValue('Fire exits');
    await userEvent.clear(field);
    await userEvent.type(field, 'Exit routes');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Topic saved.')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'PATCH /api/topics/t1')?.body).toEqual({ title: 'Exit routes' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Exit routes' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'Exit routes' })).toHaveAttribute('aria-selected', 'true');
  });

  it('edits any topic from its row, not only the one that is open, starting from its own text', async () => {
    const calls = startServer();
    renderPage('/courses/c1?topic=t1');
    await screen.findByRole('heading', { level: 2, name: 'Fire exits' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit topic <b>Alarms</b>' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit topic' });
    expect(within(dialog).getByLabelText('Topic title')).toHaveValue('<b>Alarms</b>');
    expect(within(dialog).getByLabelText('Description')).toHaveValue(topicsFixture.t2.description ?? '');
    await userEvent.clear(within(dialog).getByLabelText('Description'));
    await userEvent.type(within(dialog).getByLabelText('Description'), 'New text');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Topic saved.')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'PATCH /api/topics/t2')?.body).toEqual({ description: 'New text' });
    expect(calls.some((call) => call.key === 'PATCH /api/topics/t1')).toBe(false);
    // The open topic stays the one that was open.
    expect(screen.getByRole('heading', { level: 2, name: 'Fire exits' })).toBeInTheDocument();
  });

  it('moves a lesson down and sends the whole order of lessons', async () => {
    const calls = startServer();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Move lesson Exits down' }));
    await waitFor(() => expect(lessonsInTree().map((item) => item.getAttribute('aria-label'))).toEqual(['Equipment', 'Exits']));
    expect(calls.find((call) => call.key === 'PUT /api/courses/c1/lessons/order')?.body).toEqual({ ids: ['l2', 'l1'] });
    expect(screen.getByRole('status')).toHaveTextContent('Moved lesson "Exits" down.');
    expect(screen.getByRole('button', { name: 'Move lesson Equipment up' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('moves a topic up inside its lesson and sends only that lesson\'s order', async () => {
    const calls = startServer();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Move topic <b>Alarms</b> up' }));
    await waitFor(() => expect(within(screen.getByRole('treeitem', { name: 'Exits' })).getAllByRole('treeitem').map((item) => item.getAttribute('aria-label'))).toEqual(['<b>Alarms</b>', 'Fire exits']));
    expect(calls.find((call) => call.key === 'PUT /api/lessons/l1/topics/order')?.body).toEqual({ ids: ['t2', 't1'] });
    expect(screen.getByRole('status')).toHaveTextContent('Moved topic "<b>Alarms</b>" up.');
  });

  it('says so and reloads when the order changed under you', async () => {
    const calls = startServer({ 'PUT /api/courses/c1/lessons/order': { status: 409, body: { message: 'The list changed while you were editing it. Reload and try again.' } } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Move lesson Exits down' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The list changed');
    await waitFor(() => expect(calls.filter((call) => call.key === 'GET /api/courses/c1')).toHaveLength(2));
  });

  describe('editing a topic', () => {
    it('starts from the current text and sends only what changed', async () => {
      const calls = startServer();
      renderPage('/courses/c1?topic=t1');
      await userEvent.click(await screen.findByRole('button', { name: 'Edit topic' }));
      const dialog = screen.getByRole('dialog', { name: 'Edit topic' });
      expect(within(dialog).getByLabelText('Topic title')).toHaveValue('Fire exits');
      const text = within(dialog).getByLabelText('Description');
      expect(text).toHaveValue('Keep them clear.\nNever lock them.');
      await userEvent.clear(text);
      await userEvent.type(text, '  New text ');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit topic' })).toBeNull());
      expect(calls.find((call) => call.key === 'PATCH /api/topics/t1')?.body).toEqual({ description: 'New text' });
      expect(await screen.findByText('New text')).toBeInTheDocument();
    });

    it('clears the text with an empty description and does not call the server for no change', async () => {
      const calls = startServer();
      renderPage('/courses/c1?topic=t1');
      await userEvent.click(await screen.findByRole('button', { name: 'Edit topic' }));
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Edit topic' })).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit topic' })).toBeNull());
      expect(calls.some((call) => call.key === 'PATCH /api/topics/t1')).toBe(false);
      await userEvent.click(screen.getByRole('button', { name: 'Edit topic' }));
      await userEvent.clear(screen.getByLabelText('Description'));
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Edit topic' })).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(calls.find((call) => call.key === 'PATCH /api/topics/t1')?.body).toEqual({ description: '' }));
    });

    it('asks for a title and shows what the server says about the text', async () => {
      startServer({ 'PATCH /api/topics/t1': { status: 400, body: { message: 'Validation failed', fieldErrors: { description: ['Description must be 10,000 characters or fewer.'] } } } });
      renderPage('/courses/c1?topic=t1');
      await userEvent.click(await screen.findByRole('button', { name: 'Edit topic' }));
      await userEvent.clear(screen.getByLabelText('Topic title'));
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByText('Enter a topic title.')).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText('Topic title'), 'Fire exits again');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByText('Description must be 10,000 characters or fewer.')).toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Edit topic' })).toBeInTheDocument();
    });
  });
});
