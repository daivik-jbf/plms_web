import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../../api/client';
import { createInvite, type Role } from '../../api/staff';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Select } from '../../components/Select';
import { TextField } from '../../components/TextField';
import styles from './StaffPage.module.css';

interface InviteDialogProps {
  open: boolean;
  onClose: () => void;
  // `warning` is set when the invite was saved but its email could not be sent.
  onInvited: (email: string, warning?: string) => void;
}

export function InviteDialog({ open, onClose, onInvited }: InviteDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Invite person">
      <InviteForm onClose={onClose} onInvited={onInvited} />
    </Dialog>
  );
}

function InviteForm({ onClose, onInvited }: Pick<InviteDialogProps, 'onClose' | 'onInvited'>) {
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<'name' | 'email' | null>(null);
  const [busy, setBusy] = useState(false);

  // Focus moves only after the error text has rendered so it is announced together with the field.
  useEffect(() => {
    if (focusRequest) (focusRequest === 'name' ? nameRef : emailRef).current?.focus();
  }, [focusRequest]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next = {
      name: name.trim() ? undefined : 'Enter a name.',
      email: email.trim() ? undefined : 'Enter an email address.',
    };
    setErrors(next);
    setFailure(null);
    if (next.name || next.email) {
      setFocusRequest(next.name ? 'name' : 'email');
      return;
    }
    setBusy(true);
    try {
      await createInvite({ name, email, role });
      onInvited(email.trim().toLowerCase());
    } catch (error) {
      if (error instanceof ApiError && error.status === 502) {
        onInvited(email.trim().toLowerCase(), error.message);
      } else if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
        setErrors({ name: error.fieldErrors.name?.join(' '), email: error.fieldErrors.email?.join(' ') });
        setFailure(error.fieldErrors.role?.join(' ') ?? null);
        setFocusRequest(error.fieldErrors.name ? 'name' : 'email');
      } else {
        setFailure(describeError(error));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {failure ? <Alert tone="error">{failure}</Alert> : null}
      <TextField ref={nameRef} label="Name" autoComplete="off" data-autofocus value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
      <TextField
        ref={emailRef}
        label="Email"
        type="email"
        autoComplete="off"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        hint="The invite link is sent to this address and works once, for 7 days."
        error={errors.email}
      />
      <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
        <option value="staff">Staff</option>
        <option value="admin">Admin</option>
      </Select>
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          Send invite
        </Button>
      </div>
    </form>
  );
}
