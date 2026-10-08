import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { acceptInvite, fetchPasswordPolicy, previewInvite } from '../api/auth';
import { ApiError, describeError } from '../api/client';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { AuthLayout } from './AuthLayout';

const DEAD_LINK = 'This invite link is invalid or has expired.';

const isDeadLink = (error: unknown): boolean => error instanceof ApiError && error.status === 400 && error.message === DEAD_LINK;

export function AcceptInvitePage() {
  const token = useSearchParams()[0].get('token');
  const navigate = useNavigate();
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [invite, setInvite] = useState<{ name: string; email: string } | null>(null);
  const [minLength, setMinLength] = useState(10);
  const [linkError, setLinkError] = useState<string | null>(token ? null : DEAD_LINK);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [focusRequest, setFocusRequest] = useState<{ field: 'password' | 'confirm' } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Focus moves only after the error text has rendered, so screen readers announce the field together
  // with its new description.
  useEffect(() => {
    if (focusRequest) (focusRequest.field === 'password' ? passwordRef : confirmRef).current?.focus();
  }, [focusRequest]);

  useEffect(() => {
    if (!token) return;
    fetchPasswordPolicy().then((policy) => setMinLength(policy.minLength)).catch(() => undefined);
    previewInvite(token)
      .then(setInvite)
      .catch((error: unknown) => (isDeadLink(error) ? setLinkError(DEAD_LINK) : setLoadFailure(describeError(error))));
  }, [token]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next = {
      password: [...password].length >= minLength ? undefined : `Use at least ${minLength} characters.`,
      confirm: password === confirm ? undefined : 'The passwords do not match.',
    };
    setErrors(next);
    setFailure(null);
    if (next.password || next.confirm) {
      setFocusRequest({ field: next.password ? 'password' : 'confirm' });
      return;
    }
    if (!token) return;
    setBusy(true);
    try {
      await acceptInvite(token, password);
      navigate('/login', { replace: true, state: { notice: 'Your password is set. Sign in to continue.' } });
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors.password) {
        setErrors({ password: error.fieldErrors.password.join(' ') });
        setFocusRequest({ field: 'password' });
      } else if (isDeadLink(error)) {
        setLinkError(DEAD_LINK);
      } else {
        // Rate limits, server errors and network failures keep the form and what was typed.
        setFailure(describeError(error));
      }
    } finally {
      setBusy(false);
    }
  }

  if (linkError) {
    return (
      <AuthLayout title="Set your password">
        <Alert tone="error">{linkError}</Alert>
        <p>Ask an Admin to send you a new invite.</p>
      </AuthLayout>
    );
  }

  if (loadFailure) {
    return (
      <AuthLayout title="Set your password">
        <Alert tone="error">{loadFailure}</Alert>
        <p>Reload this page to try again.</p>
      </AuthLayout>
    );
  }

  if (!invite) {
    return (
      <AuthLayout title="Set your password">
        <p role="status">Checking your invite…</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Set your password">
      <p>
        Welcome, {invite.name}. You are signing up as <strong>{invite.email}</strong>.
      </p>
      {failure ? <Alert tone="error">{failure}</Alert> : null}
      <form onSubmit={onSubmit} noValidate>
        <TextField
          ref={passwordRef}
          label="New password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={`At least ${minLength} characters. A short sentence works well. Common passwords are not allowed.`}
          error={errors.password}
        />
        <TextField ref={confirmRef} label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
        <Button type="submit" busy={busy}>
          Set password
        </Button>
      </form>
    </AuthLayout>
  );
}
