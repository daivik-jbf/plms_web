import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { fetchPasswordPolicy, resetPassword } from '../api/auth';
import { ApiError } from '../api/client';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { AuthLayout } from './AuthLayout';

const DEAD_LINK = 'This reset link is invalid or has expired.';

export function ResetPasswordPage() {
  const token = useSearchParams()[0].get('token');
  const navigate = useNavigate();
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [minLength, setMinLength] = useState(10);
  const [linkError, setLinkError] = useState<string | null>(token ? null : DEAD_LINK);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchPasswordPolicy().then((policy) => setMinLength(policy.minLength)).catch(() => undefined);
  }, []);

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
      await resetPassword(token, password);
      navigate('/login', { replace: true, state: { notice: 'Your password has been changed. Sign in with the new one.' } });
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors.newPassword) {
        setErrors({ password: error.fieldErrors.newPassword.join(' ') });
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
      <AuthLayout title="Choose a new password">
        <Alert tone="error">{linkError}</Alert>
        <p>
          <Link to="/forgot-password">Request a new link</Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={onSubmit} noValidate>
        <TextField
          ref={passwordRef}
          label="New password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={`At least ${minLength} characters. Common passwords are not allowed.`}
          error={errors.password}
        />
        <TextField ref={confirmRef} label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
        <Button type="submit" busy={busy}>
          Change password
        </Button>
      </form>
    </AuthLayout>
  );
}
