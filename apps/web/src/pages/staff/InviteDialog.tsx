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
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title="Invite person" blocked={busy}>
      <InviteForm onClose={onClose} onInvited={onInvited} busy={busy} setBusy={setBusy} />
    </Dialog>
  );
}

function InviteForm({
  onClose,
  onInvited,
  busy,
  setBusy,
}: Pick<InviteDialogProps, 'onClose' | 'onInvited'> & { busy: boolean; setBusy: (busy: boolean) => void }) {
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const roleRef = useRef<HTMLSelectElement>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [errors, setErrors] = useState<{ name?: string; email?: string; role?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  // A new object every time, so the effect runs again even when the same field is invalid twice in a row.
  const [focusRequest, setFocusRequest] = useState<{ field: 'name' | 'email' | 'role' } | null>(null);

  // Focus moves only after the error text has rendered so it is announced together with the field.
  useEffect(() => {
    if (!focusRequest) return;
    const refs = { name: nameRef, email: emailRef, role: roleRef };
    refs[focusRequest.field].current?.focus();
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
      setFocusRequest({ field: next.name ? 'name' : 'email' });
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
        const { name: nameError, email: emailError, role: roleError } = error.fieldErrors;
        if (nameError || emailError || roleError) {
          setErrors({ name: nameError?.join(' '), email: emailError?.join(' '), role: roleError?.join(' ') });
          setFocusRequest({ field: nameError ? 'name' : emailError ? 'email' : 'role' });
        } else {
          setFailure(describeError(error));
        }
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
      <Select ref={roleRef} label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)} error={errors.role}>
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
