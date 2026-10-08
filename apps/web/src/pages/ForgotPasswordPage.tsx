import { type FormEvent, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../api/auth';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { AuthLayout } from './AuthLayout';

export function ForgotPasswordPage() {
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) {
      setError('Enter your email address.');
      emailRef.current?.focus();
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      await forgotPassword(email);
    } catch {
      // The same confirmation is shown on failure so the page never reveals anything about accounts.
    } finally {
      setBusy(false);
      setSent(true);
    }
  }

  return (
    <AuthLayout title="Reset your password">
      {sent ? (
        <Alert tone="info">If an account exists for that email, a reset link has been sent. The link works once and expires in 1 hour.</Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <TextField ref={emailRef} label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} error={error} />
          <Button type="submit" busy={busy}>
            Send reset link
          </Button>
        </form>
      )}
      <p>
        <Link to="/login">Back to sign in</Link>
      </p>
    </AuthLayout>
  );
}
