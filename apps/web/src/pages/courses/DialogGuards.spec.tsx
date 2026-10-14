import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CourseTree, LessonNode } from '../../api/courses';
import { AddLessonDialog } from './AddLessonDialog';
import { EditLessonDialog } from './EditLessonDialog';

const { updateLesson } = vi.hoisted(() => ({ updateLesson: vi.fn() }));
vi.mock('../../api/courses', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/courses')>()), updateLesson }));

const lesson: LessonNode = { id: 'l1', title: 'Exits', description: 'Where to go.', position: 0, coverUrl: null, topics: [] };
const saved = { id: 'c1', lessons: [lesson] } as unknown as CourseTree;

describe('adding asks before it throws away what was entered', () => {
  function renderAdd() {
    const onClose = vi.fn();
    render(<AddLessonDialog open onClose={onClose} onSubmit={vi.fn()} />);
    return { onClose, dialog: screen.getByRole('dialog', { name: 'Add lesson' }) };
  }

  it('closes at once when nothing was entered', async () => {
    const { onClose, dialog } = renderAdd();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Discard changes?' })).toBeNull();
  });

  it('asks first once something is typed, whether Cancel or Close is used, and keeps what was typed on Keep editing', async () => {
    const { onClose, dialog } = renderAdd();
    await userEvent.type(within(dialog).getByLabelText('Lesson title'), 'Exits');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    const ask = await screen.findByRole('dialog', { name: 'Discard changes?' });
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(within(ask).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Discard changes?' })).toBeNull());
    expect(within(dialog).getByLabelText('Lesson title')).toHaveValue('Exits');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('dialog', { name: 'Discard changes?' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes when the person chooses to discard', async () => {
    const { onClose, dialog } = renderAdd();
    await userEvent.type(within(dialog).getByLabelText('Description'), 'Some words');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Discard changes?' })).getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('editing saves only what changed, and only after the changes were shown', () => {
  beforeEach(() => updateLesson.mockReset().mockResolvedValue(saved));

  function renderEdit() {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<EditLessonDialog lesson={lesson} onClose={onClose} onSaved={onSaved} />);
    return { onClose, onSaved, dialog: screen.getByRole('dialog', { name: 'Edit lesson' }) };
  }

  it('keeps Save off until something is changed, and closes at once when nothing was', async () => {
    const { onClose, dialog } = renderEdit();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('lists what changed, before and after, and saves nothing until it is confirmed', async () => {
    const { onSaved, dialog } = renderEdit();
    const title = within(dialog).getByLabelText('Lesson title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Exit routes');
    await userEvent.clear(within(dialog).getByLabelText('Description'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    const review = await screen.findByRole('dialog', { name: 'Review your changes' });
    const items = within(review).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Title');
    expect(items[0]).toHaveTextContent('Before');
    expect(items[0]).toHaveTextContent('Exits');
    expect(items[0]).toHaveTextContent('After');
    expect(items[0]).toHaveTextContent('Exit routes');
    expect(items[1]).toHaveTextContent('Description');
    expect(items[1]).toHaveTextContent('Where to go.');
    expect(items[1]).toHaveTextContent('Nothing');
    expect(updateLesson).not.toHaveBeenCalled();

    await userEvent.click(within(review).getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Review your changes' })).toBeNull());
    expect(updateLesson).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText('Lesson title')).toHaveValue('Exit routes');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Review your changes' })).getByRole('button', { name: 'Confirm and save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(updateLesson).toHaveBeenCalledWith('l1', { title: 'Exit routes', description: '' });
  });

  it('mentions a new cover picture by its name', async () => {
    const { dialog } = renderEdit();
    await userEvent.upload(within(dialog).getByLabelText('Cover image'), new File(['x'], 'front.png', { type: 'image/png' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    const review = await screen.findByRole('dialog', { name: 'Review your changes' });
    expect(within(review).getByText(/New picture: front\.png/)).toBeInTheDocument();
  });

  it('asks before throwing away unsaved changes', async () => {
    const { onClose, dialog } = renderEdit();
    await userEvent.type(within(dialog).getByLabelText('Lesson title'), ' two');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('dialog', { name: 'Discard changes?' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
