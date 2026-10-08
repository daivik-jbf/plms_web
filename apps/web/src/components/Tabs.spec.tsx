import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Tabs } from './Tabs';

function Harness() {
  const [value, setValue] = useState('people');
  return (
    <Tabs
      label="Staff sections"
      tabs={[
        { id: 'people', label: 'People', count: 3 },
        { id: 'invites', label: 'Invites', count: 2 },
        { id: 'other', label: 'Other' },
      ]}
      value={value}
      onChange={setValue}
    >
      <p>Panel for {value}</p>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('exposes the tab pattern with counts, a selected tab and a labelled panel', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Staff sections' })).toBeInTheDocument();
    const people = screen.getByRole('tab', { name: 'People (3)' });
    expect(people).toHaveAttribute('aria-selected', 'true');
    expect(people).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Invites (2)' })).toHaveAttribute('tabindex', '-1');
    const panel = screen.getByRole('tabpanel', { name: 'People (3)' });
    expect(panel).toHaveTextContent('Panel for people');
    for (const tab of screen.getAllByRole('tab')) expect(tab).toHaveAttribute('aria-controls', panel.id);
    expect(panel.id).not.toBe('');
  });

  it('makes the panel reachable with Tab', async () => {
    render(<Harness />);
    screen.getByRole('tab', { name: 'People (3)' }).focus();
    await userEvent.tab();
    expect(screen.getByRole('tabpanel')).toHaveFocus();
  });

  it.each([{ altKey: true }, { ctrlKey: true }, { metaKey: true }])('leaves arrow, Home and End keys alone with %j (browser shortcuts)', (modifier) => {
    render(<Harness />);
    const people = screen.getByRole('tab', { name: 'People (3)' });
    people.focus();
    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
      const notPrevented = fireEvent.keyDown(people, { key, ...modifier });
      expect(notPrevented).toBe(true);
    }
    expect(people).toHaveFocus();
    expect(people).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel for people');
  });

  it('switches on click', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('tab', { name: 'Invites (2)' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel for invites');
    expect(screen.getByRole('tab', { name: 'Invites (2)' })).toHaveAttribute('aria-selected', 'true');
  });

  it('moves selection and focus with the arrow keys, wrapping, and with Home and End', async () => {
    render(<Harness />);
    screen.getByRole('tab', { name: 'People (3)' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Invites (2)' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel for invites');
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Other' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'People (3)' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Other' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'People (3)' })).toHaveFocus();
  });
});
