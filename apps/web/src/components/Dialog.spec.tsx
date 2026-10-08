import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

function Harness({ onClose = () => undefined, side }: { onClose?: () => void; side?: 'center' | 'right' | 'left' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        title="Edit thing"
        side={side}
      >
        <p>Inside the dialog</p>
        <input aria-label="First field" data-autofocus />
        <button type="button">Inner button</button>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('renders nothing inside while closed', () => {
    render(<Harness />);
    expect(screen.queryByText('Inside the dialog')).not.toBeInTheDocument();
  });

  it('opens as a labelled modal dialog and focuses the marked field', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit thing' });
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveAttribute('closedby', 'any');
    expect(screen.getByText('Inside the dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('First field')).toHaveFocus();
  });

  it('closes from the Close button and removes its content so forms start fresh next time', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByText('Inside the dialog')).not.toBeInTheDocument();
  });

  it('reports the native close event (Esc, back gesture) to onClose', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent(screen.getByRole('dialog'), new Event('close'));
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByText('Inside the dialog')).not.toBeInTheDocument();
  });

  it('light-dismisses on a click outside the dialog box (fallback for browsers without closedby)', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('dialog'), { clientX: 500, clientY: 500 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when the click lands on something inside the dialog', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(screen.getByRole('button', { name: 'Inner button' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Inside the dialog')).toBeInTheDocument();
  });

  it('can be a side drawer', async () => {
    render(<Harness side="right" />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog', { name: 'Edit thing' })).toBeInTheDocument();
  });
});
