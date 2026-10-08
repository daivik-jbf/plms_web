import { type FormEvent, useEffect, useRef, useState } from 'react';
import { changePassword, fetchPasswordPolicy, logoutAll } from '../../api/auth';
import { ApiError, describeError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TextField } from '../../components/TextField';
import styles from './AccountPage.module.css';

type FieldName = 'current' | 'next' | 'confirm';

export function AccountPage() {
  const { signOut } = useAuth();
  const currentRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  // Only a hint for the form until the policy loads (or if it cannot): the server enforces the real minimum.
  const [minLength, setMinLength] = useState(10);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ field: FieldName } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  useEffect(() => {
    fetchPasswordPolicy().then((policy) => setMinLength(policy.minLength)).catch(() => undefined);
  }, []);

  // Focus moves only after the error text has rendered, so screen readers announce the field with its error.
  useEffect(() => {
    if (!focusRequest) return;
    ({ current: currentRef, next: nextRef, confirm: confirmRef })[focusRequest.field].current?.focus();
  }, [focusRequest]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const found: Partial<Record<FieldName, string>> = {
      current: current ? undefined : 'Enter your current password.',
      next: [...next].length >= minLength ? undefined : `Use at least ${minLength} characters.`,
      confirm: next === confirm ? undefined : 'The passwords do not match.',
    };
    setErrors(found);
    setFailure(null);
    const first = (['current', 'next', 'confirm'] as const).find((field) => found[field]);
    if (first) {
      setFocusRequest({ field: first });
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      await signOut('Your password was changed. Sign in again with the new one.');
    } catch (error) {
      const fieldErrors: Partial<Record<string, string[]>> = error instanceof ApiError ? error.fieldErrors : {};
      const { currentPassword, newPassword } = fieldErrors;
      if (currentPassword || newPassword) {
        // Show every complaint under its own field, and focus the first one.
        setErrors({ current: currentPassword?.join(' '), next: newPassword?.join(' ') });
        setFocusRequest({ field: currentPassword ? 'current' : 'next' });
      } else {
        setFailure(describeError(error));
      }
      setBusy(false);
    }
  }

  async function onSignOutEverywhere() {
    setSignOutBusy(true);
    setSignOutError(null);
    try {
      await logoutAll();
      await signOut('You were signed out of all devices.');
    } catch (error) {
      setSignOutError(describeError(error));
      setSignOutBusy(false);
    }
  }

  return (
    <>
      <h1>My account</h1>

      <section className={styles.section} aria-labelledby="password-heading">
        <h2 id="password-heading">Change password</h2>
        <p>Changing your password signs you out of every device, including this one. You will sign in again with the new password.</p>
        {failure ? <Alert tone="error">{failure}</Alert> : null}
        <form onSubmit={onSubmit} noValidate className={styles.form}>
          <TextField ref={currentRef} label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} error={errors.current} />
          <TextField
            ref={nextRef}
            label="New password"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            hint={`At least ${minLength} characters. A short sentence works well. Common passwords are not allowed.`}
            error={errors.next}
          />
          <TextField ref={confirmRef} label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
          <Button type="submit" busy={busy}>
            Change password
          </Button>
        </form>
      </section>

      <section className={styles.section} aria-labelledby="devices-heading">
        <h2 id="devices-heading">Devices</h2>
        <p>Lost a phone or used a shared computer? Sign out everywhere to end every session for your account.</p>
        <Button variant="secondary" onClick={() => setConfirmingSignOut(true)}>
          Sign out of all devices
        </Button>
      </section>

      <ConfirmDialog
        open={confirmingSignOut}
        title="Sign out of all devices?"
        confirmLabel="Sign out everywhere"
        busy={signOutBusy}
        error={signOutError}
        onCancel={() => {
          setConfirmingSignOut(false);
          setSignOutError(null);
        }}
        onConfirm={() => void onSignOutEverywhere()}
      >
        Every session for your account ends, on this computer and on your phone. You will need to sign in again.
      </ConfirmDialog>
    </>
  );
}
