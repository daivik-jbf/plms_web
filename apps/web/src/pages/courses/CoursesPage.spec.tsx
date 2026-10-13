import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CourseSummary, CourseTree } from '../../api/courses';
import type { MockResponse } from '../../test/fetch-mock';
import { ADMIN, mockSession, renderWithSession, STAFF } from '../../test/session';
import { CoursesPage } from './CoursesPage';

const course = (overrides: Partial<CourseSummary> & { id: string; title: string }): CourseSummary => ({
  description: null,
  position: 0,
  coverUrl: null,
  lessonCount: 0,
  topicCount: 0,
  createdBy: { id: 'u1', name: 'Anita Rao' },
  createdAt: '2026-10-09T10:00:00Z',
  ...overrides,
});

const fixture: CourseSummary[] = [
  course({ id: 'c1', title: 'Fire safety', lessonCount: 3, topicCount: 7, coverUrl: 'https://cdn.example/cover?sig=1' }),
  course({ id: 'c2', title: 'First aid', position: 1, lessonCount: 1, topicCount: 2 }),
  course({ id: 'c3', title: '<img src=x onerror=alert(1)>', position: 2 }),
];

const lessonsOfFireSafety = () => [
  {
    id: 'l1',
    title: 'Extinguishers',
    position: 0,
    topics: [
      { id: 't1', title: 'Types', position: 0, attachmentCount: 1 },
      { id: 't2', title: 'Using one', position: 1, attachmentCount: 0 },
    ],
  },
  { id: 'l2', title: 'Escape routes', position: 1, topics: [] },
];

// The cover is left out of the tree so that the list holds the only picture on the page.
const tree = (id: string, title: string): CourseTree => ({
  id,
  title,
  description: null,
  position: 0,
  coverUrl: null,
  createdBy: { id: 'u1', name: 'Anita Rao' },
  createdAt: '2026-10-09T10:00:00Z',
  lessons: id === 'c1' ? lessonsOfFireSafety() : [],
});

type Override = MockResponse | ((body: Record<string, unknown>) => MockResponse);

function startServer(overrides: Record<string, Override> = {}, initial: CourseSummary[] = fixture, user = STAFF) {
  const state = { courses: structuredClone(initial) };
  const calls: { key: string; body: Record<string, unknown> }[] = [];
  mockSession(user, (url, init) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ key, body });
    const override = overrides[key];
    if (override) return typeof override === 'function' ? override(body) : override;
    if (key === 'GET /api/courses') return { body: state.courses };
    const read = /^GET \/api\/courses\/([^/]+)$/.exec(key);
    if (read) {
      const found = state.courses.find((candidate) => candidate.id === read[1]);
      return found ? { body: tree(found.id, found.title) } : { status: 404, body: {} };
    }
    if (key === 'POST /api/courses') {
      const created = course({ id: 'c-new', title: String(body.title), description: (body.description as string) || null, position: state.courses.length });
      state.courses.push(created);
      return { status: 201, body: created };
    }
    const edit = /^PATCH \/api\/courses\/([^/]+)$/.exec(key);
    if (edit) {
      state.courses.find((candidate) => candidate.id === edit[1])!.title = String(body.title);
      return { body: {} };
    }
    const removeCourse = /^DELETE \/api\/courses\/([^/]+)$/.exec(key);
    if (removeCourse) {
      state.courses = state.courses.filter((candidate) => candidate.id !== removeCourse[1]);
      return { status: 204, body: null };
    }
    if (key === 'POST /api/lessons/l1/cover') return { status: 201, body: { fileId: 'f9', url: 'https://upload.example/cover', headers: { 'Content-Type': 'image/png' } } };
    if (key === 'PUT https://upload.example/cover') return { status: 200, body: {} };
    if (key === 'POST /api/lessons/l1/cover/f9/complete') {
      const covered = tree('c1', 'Fire safety');
      covered.lessons[0]!.coverUrl = 'https://cdn.example/lesson?sig=1';
      return { body: covered };
    }
    if (key === 'PUT /api/courses/order') {
      const ids = body.ids as string[];
      state.courses = ids.map((id, index) => ({ ...state.courses.find((candidate) => candidate.id === id)!, position: index }));
      return { body: state.courses };
    }
    return { status: 404, body: {} };
  });
  return calls;
}

describe('CoursesPage', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('lists the courses with their lesson and topic counts, and shows the first one in full', async () => {
    startServer();
    renderWithSession(<CoursesPage />);
    const list = await screen.findByRole('region', { name: 'All courses' });
    const first = within(list).getByRole('button', { name: /^Fire safety/ });
    expect(first).toHaveTextContent('3 Lessons • 7 Topics');
    expect(first).toHaveAttribute('aria-current', 'true');
    expect(within(list).getByRole('button', { name: /^First aid/ })).toHaveTextContent('1 Lesson • 2 Topics');
    expect(await screen.findByRole('heading', { name: 'Fire safety', level: 2 })).toBeInTheDocument();
    const lessons = await screen.findByRole('region', { name: 'Lessons' });
    expect(within(lessons).getByText('Extinguishers')).toBeInTheDocument();
    expect(within(lessons).getByText('2 topics')).toBeInTheDocument();
    expect(within(lessons).getByRole('link', { name: 'Open lesson Extinguishers' })).toHaveAttribute('href', '/courses/c1?topic=t1');
    expect(within(screen.getByRole('region', { name: 'Course summary' })).getByText('Total Lessons').parentElement).toHaveTextContent('2');
  });

  it('shows the course that is chosen in the list', async () => {
    startServer();
    renderWithSession(<CoursesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /^First aid/ }));
    expect(await screen.findByRole('heading', { name: 'First aid', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^First aid/ })).toHaveAttribute('aria-current', 'true');
    expect(await screen.findByText('No lessons yet')).toBeInTheDocument();
  });

  it('filters the list by what is typed', async () => {
    startServer();
    renderWithSession(<CoursesPage />);
    await userEvent.type(await screen.findByLabelText('Search courses in this list'), 'first');
    const list = screen.getByRole('region', { name: 'All courses' });
    expect(within(list).queryByRole('button', { name: /^Fire safety/ })).toBeNull();
    expect(within(list).getByRole('button', { name: /^First aid/ })).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Search courses in this list'));
    await userEvent.type(screen.getByLabelText('Search courses in this list'), 'zzz');
    expect(screen.getByText(/No course matches/)).toBeInTheDocument();
  });

  it('shows a cover picture where there is one and a placeholder where there is not', async () => {
    startServer();
    renderWithSession(<CoursesPage />);
    await screen.findByRole('region', { name: 'All courses' });
    const pictures = document.querySelectorAll('img');
    expect(pictures).toHaveLength(1);
    expect(pictures[0]).toHaveAttribute('src', 'https://cdn.example/cover?sig=1');
    expect(pictures[0]).toHaveAttribute('alt', '');
  });

  it('shows hostile course titles as plain text', async () => {
    startServer();
    renderWithSession(<CoursesPage />);
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelectorAll('img')).toHaveLength(1);
  });

  it('shows an empty state with a way forward', async () => {
    startServer({}, []);
    renderWithSession(<CoursesPage />);
    expect(await screen.findByText('No courses yet')).toBeInTheDocument();
    expect(screen.getByText(/create a course/i)).toBeInTheDocument();
  });

  it('shows a loading state, then offers Retry when loading fails', async () => {
    let fail = true;
    startServer({ 'GET /api/courses': () => (fail ? { status: 500, body: {} } : { body: fixture }) });
    renderWithSession(<CoursesPage />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: 'All courses' })).toBeInTheDocument();
  });

  it('adds a lesson to the course that is shown', async () => {
    const calls = startServer({
      'POST /api/courses/c1/lessons': { status: 201, body: { ...tree('c1', 'Fire safety'), lessons: [{ id: 'l9', title: 'Drills', position: 0, topics: [] }] } },
    });
    renderWithSession(<CoursesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add Lesson' }));
    await userEvent.type(screen.getByLabelText('Lesson title'), 'Drills');
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Add lesson' })).getByRole('button', { name: 'Add lesson' }));
    expect(await screen.findByText('Lesson "Drills" added.')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'POST /api/courses/c1/lessons')?.body).toEqual({ title: 'Drills' });
  });

  it('lists the topics of the course on the Topics tab', async () => {
    startServer();
    renderWithSession(<CoursesPage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Topics' }));
    const topics = await screen.findByRole('region', { name: 'Topics' });
    expect(within(topics).getByText('Using one')).toBeInTheDocument();
    expect(within(topics).getByRole('link', { name: 'Open topic Types' })).toHaveAttribute('href', '/courses/c1?topic=t1');
  });

  it('creates a course from a trimmed title and a description, and shows it', async () => {
    const calls = startServer();
    renderWithSession(<CoursesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'New course' }));
    const dialog = screen.getByRole('dialog', { name: 'New course' });
    await userEvent.type(within(dialog).getByLabelText('Course title'), '  Orientation ');
    await userEvent.type(within(dialog).getByLabelText('Description'), 'Your first week.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create course' }));
    expect(await screen.findByText('Course "Orientation" created.')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'POST /api/courses')?.body).toEqual({ title: 'Orientation', description: 'Your first week.' });
    expect(await screen.findByRole('button', { name: /^Orientation/ })).toBeInTheDocument();
  });

  it('asks for a title before sending anything', async () => {
    const calls = startServer();
    renderWithSession(<CoursesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'New course' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create course' }));
    expect(await screen.findByText('Enter a course title.')).toBeInTheDocument();
    expect(screen.getByLabelText('Course title')).toHaveFocus();
    expect(calls.some((call) => call.key.startsWith('POST'))).toBe(false);
  });

  it('shows what the server says about a title inside the dialog and keeps it open', async () => {
    startServer({ 'POST /api/courses': { status: 400, body: { message: 'Validation failed', fieldErrors: { title: ['Title must be 200 characters or fewer.'] } } } });
    renderWithSession(<CoursesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'New course' }));
    await userEvent.type(screen.getByLabelText('Course title'), 'Fire');
    await userEvent.click(screen.getByRole('button', { name: 'Create course' }));
    expect(await screen.findByText('Title must be 200 characters or fewer.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'New course' })).toBeInTheDocument();
  });

  it('cannot be dismissed while the request is running', async () => {
    let release: (value: MockResponse) => void = () => undefined;
    const pending = new Promise<MockResponse>((resolve) => (release = resolve));
    startServer({ 'POST /api/courses': () => pending as unknown as MockResponse });
    renderWithSession(<CoursesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'New course' }));
    await userEvent.type(screen.getByLabelText('Course title'), 'Slow one');
    await userEvent.click(screen.getByRole('button', { name: 'Create course' }));
    const dialog = screen.getByRole('dialog', { name: 'New course' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled());
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    release({ status: 201, body: course({ id: 'c-slow', title: 'Slow one' }) });
    expect(await screen.findByText('Course "Slow one" created.')).toBeInTheDocument();
  });

  it('renames a course from the menu in the list, starting from its current title', async () => {
    const calls = startServer();
    renderWithSession(<CoursesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for First aid' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename course' });
    const field = within(dialog).getByLabelText('Course title');
    expect(field).toHaveValue('First aid');
    expect(within(dialog).queryByLabelText('Description')).toBeNull();
    await userEvent.clear(field);
    await userEvent.type(field, 'Emergency care');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Course renamed to "Emergency care".')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'PATCH /api/courses/c2')?.body).toEqual({ title: 'Emergency care' });
  });

  it('moves a course from the menu in the list, disables the moves that are not possible, and sends the whole order', async () => {
    const calls = startServer();
    renderWithSession(<CoursesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Fire safety' }));
    expect(screen.getByRole('menuitem', { name: 'Move up' })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Fire safety' }));
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Move up' })).not.toHaveAttribute('aria-disabled'));
    expect(calls.find((call) => call.key === 'PUT /api/courses/order')?.body).toEqual({ ids: ['c2', 'c1', 'c3'] });
    expect(screen.getByRole('status')).toHaveTextContent('Moved "Fire safety" down.');
    const buttons = within(screen.getByRole('region', { name: 'All courses' })).getAllByRole('button', { name: /Lesson/ });
    expect(buttons[0]).toHaveTextContent('First aid');
  });

  it('moves a lesson and sends the whole order of the lessons', async () => {
    const [first, second] = lessonsOfFireSafety();
    const calls = startServer({ 'PUT /api/courses/c1/lessons/order': { body: { ...tree('c1', 'Fire safety'), lessons: [second, first] } } });
    renderWithSession(<CoursesPage />);
    expect(await screen.findByRole('button', { name: 'Move lesson Extinguishers up' })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Move lesson Extinguishers down' }));
    expect(await screen.findByText('Moved lesson "Extinguishers" down.')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'PUT /api/courses/c1/lessons/order')?.body).toEqual({ ids: ['l2', 'l1'] });
  });

  it('says so and reloads when the order changed under you', async () => {
    startServer({ 'PUT /api/courses/order': { status: 409, body: { message: 'The list changed while you were editing it. Reload and try again.' } } });
    renderWithSession(<CoursesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Fire safety' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The list changed');
    expect(await screen.findByRole('region', { name: 'All courses' })).toBeInTheDocument();
  });

  describe('deleting', () => {
    it('shows no way to delete to Staff', async () => {
      startServer();
      renderWithSession(<CoursesPage />);
      await userEvent.click(await screen.findByRole('button', { name: 'Actions for Fire safety' }));
      expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
      await userEvent.keyboard('{Escape}');
      await userEvent.click(await screen.findByRole('button', { name: 'More actions for Fire safety' }));
      expect(screen.queryByRole('menuitem', { name: 'Delete course' })).toBeNull();
      await screen.findByRole('region', { name: 'Lessons' });
      await userEvent.click(screen.getByRole('button', { name: 'Actions for lesson Extinguishers' }));
      expect(screen.queryByRole('menuitem', { name: 'Delete lesson' })).toBeNull();
    });

    it('asks first, then moves the course to the Trash and takes it out of the list', async () => {
      const calls = startServer({}, fixture, ADMIN);
      renderWithSession(<CoursesPage />);
      await userEvent.click(await screen.findByRole('button', { name: 'Actions for First aid' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
      const dialog = screen.getByRole('dialog', { name: 'Delete course' });
      expect(dialog).toHaveTextContent('Delete the course "First aid"? It moves to the Trash with its 1 lesson, 2 topics and their files.');
      expect(calls.some((call) => call.key.startsWith('DELETE'))).toBe(false);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Move to Trash' }));
      expect(await screen.findByText('Course "First aid" moved to the Trash.')).toBeInTheDocument();
      expect(calls.some((call) => call.key === 'DELETE /api/courses/c2')).toBe(true);
      await waitFor(() => expect(screen.queryByRole('button', { name: /^First aid/ })).toBeNull());
    });

    it('can be called off, and sends nothing', async () => {
      const calls = startServer({}, fixture, ADMIN);
      renderWithSession(<CoursesPage />);
      await userEvent.click(await screen.findByRole('button', { name: 'Actions for First aid' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete course' })).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(calls.some((call) => call.key.startsWith('DELETE'))).toBe(false);
    });

    it('shows what the server says inside the dialog and keeps it open', async () => {
      startServer({ 'DELETE /api/courses/c2': { status: 404, body: { message: 'Course not found.' } } }, fixture, ADMIN);
      renderWithSession(<CoursesPage />);
      await userEvent.click(await screen.findByRole('button', { name: 'Actions for First aid' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
      const dialog = screen.getByRole('dialog', { name: 'Delete course' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Move to Trash' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Course not found.');
      expect(screen.getByRole('dialog', { name: 'Delete course' })).toBeInTheDocument();
    });

    it('deletes the course that is shown from the menu in its banner', async () => {
      const calls = startServer({}, fixture, ADMIN);
      renderWithSession(<CoursesPage />);
      await userEvent.click(await screen.findByRole('button', { name: 'More actions for Fire safety' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Delete course' }));
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete course' })).getByRole('button', { name: 'Move to Trash' }));
      await waitFor(() => expect(calls.some((call) => call.key === 'DELETE /api/courses/c1')).toBe(true));
    });

    it('moves a lesson to the Trash and shows the course without it', async () => {
      const remaining = { ...tree('c1', 'Fire safety'), lessons: [lessonsOfFireSafety()[1]] };
      const calls = startServer({ 'DELETE /api/lessons/l1': { body: remaining } }, fixture, ADMIN);
      renderWithSession(<CoursesPage />);
      await userEvent.click(await screen.findByRole('button', { name: 'Actions for lesson Extinguishers' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Delete lesson' }));
      const dialog = screen.getByRole('dialog', { name: 'Delete lesson' });
      expect(dialog).toHaveTextContent('Delete the lesson "Extinguishers"? It moves to the Trash with its 2 topics and their files.');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Move to Trash' }));
      expect(await screen.findByText('Lesson "Extinguishers" moved to the Trash.')).toBeInTheDocument();
      expect(calls.some((call) => call.key === 'DELETE /api/lessons/l1')).toBe(true);
      expect(screen.queryByText('Extinguishers')).toBeNull();
    });

    it('moves a topic to the Trash from the Topics tab', async () => {
      const remaining = tree('c1', 'Fire safety');
      remaining.lessons[0]!.topics = [remaining.lessons[0]!.topics[0]!];
      const calls = startServer({ 'DELETE /api/topics/t2': { body: remaining } }, fixture, ADMIN);
      renderWithSession(<CoursesPage />);
      await userEvent.click(await screen.findByRole('tab', { name: 'Topics' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Actions for topic Using one' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Delete topic' }));
      await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete topic' })).getByRole('button', { name: 'Move to Trash' }));
      expect(await screen.findByText('Topic "Using one" moved to the Trash.')).toBeInTheDocument();
      expect(calls.some((call) => call.key === 'DELETE /api/topics/t2')).toBe(true);
    });
  });

  it('edits any topic from the Topics tab, for Staff too, starting from its own text', async () => {
    const calls = startServer({
      'GET /api/topics/t1': { body: { id: 't1', lessonId: 'l1', courseId: 'c1', title: 'Types', description: 'Kinds of extinguisher.', position: 0 } },
      'PATCH /api/topics/t1': { body: {} },
    });
    renderWithSession(<CoursesPage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Topics' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for topic Types' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit topic' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit topic' });
    expect(within(dialog).getByLabelText('Description')).toHaveValue('Kinds of extinguisher.');
    await userEvent.clear(within(dialog).getByLabelText('Topic title'));
    await userEvent.type(within(dialog).getByLabelText('Topic title'), 'Kinds');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Topic saved.')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'PATCH /api/topics/t1')?.body).toEqual({ title: 'Kinds' });
  });

  describe('covers', () => {
    it('shows the cover of a lesson in place of its number', async () => {
      startServer({ 'GET /api/courses/c1': { body: { ...tree('c1', 'Fire safety'), lessons: [{ ...lessonsOfFireSafety()[0]!, coverUrl: 'https://cdn.example/lesson?sig=1' }] } } });
      renderWithSession(<CoursesPage />);
      const lessons = await screen.findByRole('region', { name: 'Lessons' });
      expect(lessons.querySelector('img')).toHaveAttribute('src', 'https://cdn.example/lesson?sig=1');
    });

    it('changes the cover of a lesson from its menu, in three steps, and shows it', async () => {
      const calls = startServer();
      renderWithSession(<CoursesPage />);
      await userEvent.click(await screen.findByRole('button', { name: 'Actions for lesson Extinguishers' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Change cover' }));
      const dialog = screen.getByRole('dialog', { name: 'Lesson cover' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      expect(await within(dialog).findByText('Choose an image.')).toBeInTheDocument();
      await userEvent.upload(within(dialog).getByLabelText('Cover image'), new File(['x'], 'cover.png', { type: 'image/png' }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      expect(await screen.findByText('Cover of the lesson "Extinguishers" saved.')).toBeInTheDocument();
      expect(calls.map((call) => call.key)).toEqual(expect.arrayContaining(['POST /api/lessons/l1/cover', 'PUT https://upload.example/cover', 'POST /api/lessons/l1/cover/f9/complete']));
      const lessons = await screen.findByRole('region', { name: 'Lessons' });
      expect(lessons.querySelector('img')).toHaveAttribute('src', 'https://cdn.example/lesson?sig=1');
    });
  });
});
