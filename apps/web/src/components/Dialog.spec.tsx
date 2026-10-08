import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';
import styles from './Dialog.module.css';

function Harness({
  onClose = () => undefined,
  side,
  blocked,
}: {
  onClose?: () => void;
  side?: 'center' | 'right' | 'left';
  blocked?: boolean;
}) {
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
        blocked={blocked}
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

  it.each([
    ['right', 'left'],
    ['left', 'right'],
  ] as const)('can be a %s side drawer', async (side, other) => {
    render(<Harness side={side} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit thing' });
    expect(dialog).toHaveClass(styles.dialog!, styles[side]!);
    expect(dialog).not.toHaveClass(styles[other]!);
  });

  it.each([undefined, 'center'] as const)('is a centered dialog with side=%s', async (side) => {
    render(<Harness side={side} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit thing' });
    expect(dialog.className).toBe(styles.dialog);
  });

  describe('while blocked', () => {
    it('cancels the native cancel event (Esc, back gesture, light dismiss) so the dialog stays open', async () => {
      const onClose = vi.fn();
      render(<Harness blocked onClose={onClose} />);
      await userEvent.click(screen.getByRole('button', { name: 'Open' }));
      const notPrevented = fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
      expect(notPrevented).toBe(false);
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog', { name: 'Edit thing' })).toBeInTheDocument();
    });

    it('ignores a click outside the dialog box and disables the Close button', async () => {
      const onClose = vi.fn();
      render(<Harness blocked onClose={onClose} />);
      await userEvent.click(screen.getByRole('button', { name: 'Open' }));
      fireEvent.click(screen.getByRole('dialog'), { clientX: 500, clientY: 500 });
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    });
  });

  it('does not prevent the cancel event when not blocked', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))).toBe(true);
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
  });
});
