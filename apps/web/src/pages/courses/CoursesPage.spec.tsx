import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CourseSummary } from '../../api/courses';
import type { MockResponse } from '../../test/fetch-mock';
import { mockSession, renderWithSession, STAFF } from '../../test/session';
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

type Override = MockResponse | ((body: Record<string, unknown>) => MockResponse);

function startServer(overrides: Record<string, Override> = {}, initial: CourseSummary[] = fixture) {
  const state = { courses: structuredClone(initial) };
  const calls: { key: string; body: Record<string, unknown> }[] = [];
  mockSession(STAFF, (url, init) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ key, body });
    const override = overrides[key];
    if (override) return typeof override === 'function' ? override(body) : override;
    if (key === 'GET /api/courses') return { body: state.courses };
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

  it('lists the courses with their lesson and topic counts and an Open link to each', async () => {
    startServer();
    renderWithSession(<CoursesPage />);
    const table = await screen.findByRole('table', { name: 'Courses' });
    const row = within(table).getByRole('row', { name: /Fire safety/ });
    expect(within(row).getByText('3')).toBeInTheDocument();
    expect(within(row).getByText('7')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Open Fire safety' })).toHaveAttribute('href', '/courses/c1');
    expect(within(table).getByRole('columnheader', { name: 'Lessons' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Topics' })).toBeInTheDocument();
  });

  it('shows a cover picture where there is one and a placeholder where there is not', async () => {
    startServer();
    renderWithSession(<CoursesPage />);
    await screen.findByRole('table', { name: 'Courses' });
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
    expect(await screen.findByRole('table', { name: 'Courses' })).toBeInTheDocument();
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
    expect(await screen.findByRole('link', { name: 'Open Orientation' })).toBeInTheDocument();
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

  it('renames a course, starting from its current title', async () => {
    const calls = startServer();
    renderWithSession(<CoursesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Rename First aid' }));
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

  it('moves a course down, disables the moves that are not possible, and sends the whole order', async () => {
    const calls = startServer();
    renderWithSession(<CoursesPage />);
    await screen.findByRole('table', { name: 'Courses' });
    expect(screen.getByRole('button', { name: 'Move Fire safety up' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Move <img src=x onerror=alert(1)> down' })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Move Fire safety down' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move Fire safety up' })).not.toHaveAttribute('aria-disabled'));
    expect(calls.find((call) => call.key === 'PUT /api/courses/order')?.body).toEqual({ ids: ['c2', 'c1', 'c3'] });
    expect(screen.getByRole('status')).toHaveTextContent('Moved "Fire safety" down.');
    const rows = within(screen.getByRole('table', { name: 'Courses' })).getAllByRole('row').slice(1);
    expect(within(rows[0] as HTMLElement).getByRole('link', { name: 'Open First aid' })).toBeInTheDocument();
  });

  it('says so and reloads when the order changed under you', async () => {
    startServer({ 'PUT /api/courses/order': { status: 409, body: { message: 'The list changed while you were editing it. Reload and try again.' } } });
    renderWithSession(<CoursesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Move Fire safety down' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The list changed');
    expect(await screen.findByRole('table', { name: 'Courses' })).toBeInTheDocument();
  });
});
