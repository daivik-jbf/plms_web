import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LessonNode } from '../../api/courses';
import { CourseOutline } from './CourseOutline';

const lessons: LessonNode[] = [
  {
    id: 'l1',
    title: 'Exits',
    position: 0,
    topics: [
      { id: 't1', title: 'Fire exits', position: 0, attachmentCount: 2 },
      { id: 't2', title: 'Alarms', position: 1, attachmentCount: 0 },
    ],
  },
  { id: 'l2', title: 'Empty lesson', position: 1, topics: [] },
  { id: 'l3', title: '<b>Equipment</b>', position: 2, topics: [{ id: 't3', title: '<img src=x onerror=alert(1)>', position: 0, attachmentCount: 1 }] },
];

function setup(selectedTopicId: string | null = null) {
  const onSelectTopic = vi.fn();
  const view = render(<CourseOutline lessons={lessons} selectedTopicId={selectedTopicId} onSelectTopic={onSelectTopic} />);
  return { onSelectTopic, ...view };
}

const names = () => screen.getAllByRole('treeitem').map((item) => item.getAttribute('aria-label'));

describe('CourseOutline', () => {
  it('is a tree of lessons, all open, holding their topics, and says which topic is selected', () => {
    setup('t2');
    expect(screen.getByRole('tree', { name: 'Course contents' })).toBeInTheDocument();
    expect(names()).toEqual(['Exits', 'Fire exits', 'Alarms', 'Empty lesson', '<b>Equipment</b>', '<img src=x onerror=alert(1)>']);
    const lesson = screen.getByRole('treeitem', { name: 'Exits' });
    expect(lesson).toHaveAttribute('aria-level', '1');
    expect(lesson).toHaveAttribute('aria-expanded', 'true');
    const topic = screen.getByRole('treeitem', { name: 'Alarms' });
    expect(topic).toHaveAttribute('aria-level', '2');
    expect(topic).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('treeitem', { name: 'Fire exits' })).toHaveAttribute('aria-selected', 'false');
    expect(within(lesson).getAllByRole('treeitem')).toHaveLength(2);
  });

  it('shows how many files a topic has, and a hint for a lesson without topics', () => {
    setup();
    expect(within(screen.getByRole('treeitem', { name: 'Fire exits' })).getByText('2 files')).toBeInTheDocument();
    expect(within(screen.getByRole('treeitem', { name: 'Alarms' })).getByText('No files')).toBeInTheDocument();
    expect(within(screen.getByRole('treeitem', { name: '<img src=x onerror=alert(1)>' })).getByText('1 file')).toBeInTheDocument();
    expect(within(screen.getByRole('treeitem', { name: 'Empty lesson' })).getByText('No topics yet')).toBeInTheDocument();
  });

  it('shows hostile titles as plain text', () => {
    setup();
    expect(screen.getByText('<b>Equipment</b>')).toBeInTheDocument();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
  });

  it('lets exactly one item be reached with Tab: the selected topic, else the first lesson', () => {
    const { unmount } = setup('t2');
    expect(screen.getAllByRole('treeitem').filter((item) => item.tabIndex === 0).map((item) => item.getAttribute('aria-label'))).toEqual(['Alarms']);
    unmount();
    setup();
    expect(screen.getAllByRole('treeitem').filter((item) => item.tabIndex === 0).map((item) => item.getAttribute('aria-label'))).toEqual(['Exits']);
  });

  it('closes and opens a lesson when its title is clicked, announcing the state', async () => {
    setup();
    await userEvent.click(within(screen.getByRole('treeitem', { name: 'Exits' })).getByText('Exits'));
    expect(screen.getByRole('treeitem', { name: 'Exits' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('treeitem', { name: 'Fire exits' })).toBeNull();
    await userEvent.click(within(screen.getByRole('treeitem', { name: 'Exits' })).getByText('Exits'));
    expect(screen.getByRole('treeitem', { name: 'Exits' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('treeitem', { name: 'Fire exits' })).toBeInTheDocument();
  });

  it('chooses a topic when its title is clicked, and does nothing else', async () => {
    const { onSelectTopic } = setup();
    await userEvent.click(within(screen.getByRole('treeitem', { name: 'Alarms' })).getByText('Alarms'));
    expect(onSelectTopic).toHaveBeenCalledTimes(1);
    expect(onSelectTopic).toHaveBeenCalledWith('t2');
    expect(screen.getByRole('treeitem', { name: 'Exits' })).toHaveAttribute('aria-expanded', 'true');
  });

  describe('with the keyboard', () => {
    const focused = () => document.activeElement?.getAttribute('aria-label');

    it('moves through the visible items with the arrow keys, Home and End, and keeps the Tab stop where it is', async () => {
      setup();
      await userEvent.tab();
      expect(focused()).toBe('Exits');
      await userEvent.keyboard('{ArrowDown}');
      expect(focused()).toBe('Fire exits');
      await userEvent.keyboard('{ArrowDown}{ArrowDown}');
      expect(focused()).toBe('Empty lesson');
      await userEvent.keyboard('{ArrowUp}');
      expect(focused()).toBe('Alarms');
      await userEvent.keyboard('{End}');
      expect(focused()).toBe('<img src=x onerror=alert(1)>');
      await userEvent.keyboard('{ArrowDown}');
      expect(focused()).toBe('<img src=x onerror=alert(1)>');
      await userEvent.keyboard('{Home}');
      expect(focused()).toBe('Exits');
      await userEvent.keyboard('{ArrowUp}');
      expect(focused()).toBe('Exits');
      await userEvent.keyboard('{End}');
      expect(screen.getAllByRole('treeitem').filter((item) => item.tabIndex === 0).map((item) => item.getAttribute('aria-label'))).toEqual(['<img src=x onerror=alert(1)>']);
    });

    it('closes an open lesson with Left, opens it again with Right, and steps into and out of it', async () => {
      setup();
      await userEvent.tab();
      await userEvent.keyboard('{ArrowLeft}');
      expect(screen.getByRole('treeitem', { name: 'Exits' })).toHaveAttribute('aria-expanded', 'false');
      expect(focused()).toBe('Exits');
      await userEvent.keyboard('{ArrowLeft}');
      expect(focused()).toBe('Exits');
      await userEvent.keyboard('{ArrowRight}');
      expect(screen.getByRole('treeitem', { name: 'Exits' })).toHaveAttribute('aria-expanded', 'true');
      expect(focused()).toBe('Exits');
      await userEvent.keyboard('{ArrowRight}');
      expect(focused()).toBe('Fire exits');
      await userEvent.keyboard('{ArrowRight}');
      expect(focused()).toBe('Fire exits');
      await userEvent.keyboard('{ArrowLeft}');
      expect(focused()).toBe('Exits');
    });

    it('does not step into a lesson that has no topics', async () => {
      setup();
      await userEvent.tab();
      await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
      expect(focused()).toBe('Empty lesson');
      await userEvent.keyboard('{ArrowRight}');
      expect(focused()).toBe('Empty lesson');
    });

    it('chooses a topic with Enter or Space, and opens or closes a lesson the same way', async () => {
      const { onSelectTopic } = setup();
      await userEvent.tab();
      await userEvent.keyboard('{Enter}');
      expect(screen.getByRole('treeitem', { name: 'Exits' })).toHaveAttribute('aria-expanded', 'false');
      await userEvent.keyboard(' ');
      expect(screen.getByRole('treeitem', { name: 'Exits' })).toHaveAttribute('aria-expanded', 'true');
      await userEvent.keyboard('{ArrowDown}{Enter}');
      expect(onSelectTopic).toHaveBeenLastCalledWith('t1');
      await userEvent.keyboard('{ArrowDown} ');
      expect(onSelectTopic).toHaveBeenLastCalledWith('t2');
      expect(onSelectTopic).toHaveBeenCalledTimes(2);
    });

    it('skips the topics of a closed lesson', async () => {
      setup();
      await userEvent.tab();
      await userEvent.keyboard('{ArrowLeft}{ArrowDown}');
      expect(focused()).toBe('Empty lesson');
    });
  });
});
