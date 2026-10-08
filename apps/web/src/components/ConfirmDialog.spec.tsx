import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

const renderDialog = (props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog open title="Deactivate Ben?" confirmLabel="Deactivate" tone="danger" onConfirm={onConfirm} onCancel={onCancel} {...props}>
      Ben will be signed out immediately.
    </ConfirmDialog>,
  );
  return { onConfirm, onCancel };
};

describe('ConfirmDialog', () => {
  it('shows the message and calls the right handler for each button', async () => {
    const { onConfirm, onCancel } = renderDialog();
    expect(screen.getByRole('dialog', { name: 'Deactivate Ben?' })).toBeInTheDocument();
    expect(screen.getByText('Ben will be signed out immediately.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while busy so a second click cannot submit twice', async () => {
    const { onConfirm } = renderDialog({ busy: true });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    const confirm = screen.getByRole('button', { name: 'Deactivate' });
    expect(confirm).toBeDisabled();
    await userEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('can word the cancel button differently', () => {
    renderDialog({ cancelLabel: 'Keep invite' });
    expect(screen.getByRole('button', { name: 'Keep invite' })).toBeInTheDocument();
  });

  it('shows a server error inside the dialog', () => {
    renderDialog({ error: 'At least one active Admin is required.' });
    expect(screen.getByRole('alert')).toHaveTextContent('At least one active Admin is required.');
  });
});
