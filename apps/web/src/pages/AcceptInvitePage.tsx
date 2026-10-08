import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { acceptInvite, fetchPasswordPolicy, previewInvite } from '../api/auth';
import { ApiError } from '../api/client';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { AuthLayout } from './AuthLayout';

const DEAD_LINK = 'This invite link is invalid or has expired.';

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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetchPasswordPolicy().then((policy) => setMinLength(policy.minLength)).catch(() => undefined);
    previewInvite(token)
      .then(setInvite)
      .catch((error: unknown) => setLinkError(error instanceof ApiError ? error.message : DEAD_LINK));
  }, [token]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next = {
      password: [...password].length >= minLength ? undefined : `Use at least ${minLength} characters.`,
      confirm: password === confirm ? undefined : 'The passwords do not match.',
    };
    setErrors(next);
    if (next.password || next.confirm) {
      (next.password ? passwordRef : confirmRef).current?.focus();
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
        passwordRef.current?.focus();
      } else {
        setLinkError(error instanceof ApiError ? error.message : DEAD_LINK);
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
