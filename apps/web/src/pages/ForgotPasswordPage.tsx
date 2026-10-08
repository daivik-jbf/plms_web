import { type FormEvent, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../api/auth';
import { ApiError, TOO_MANY_REQUESTS } from '../api/client';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { AuthLayout } from './AuthLayout';

export function ForgotPasswordPage() {
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    if (!email.trim()) {
      setError('Enter your email address.');
      emailRef.current?.focus();
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 400) {
        setError(caught.fieldErrors.email?.join(' ') ?? caught.message);
        emailRef.current?.focus();
      } else if (caught instanceof ApiError && caught.status === 429) {
        setFailure(TOO_MANY_REQUESTS);
      } else {
        // Server and network failures show the same confirmation, so the page never reveals anything
        // about which accounts exist.
        setSent(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Reset your password">
      {sent ? (
        <Alert tone="info">If an account exists for that email, a reset link has been sent. The link works once and expires in 1 hour.</Alert>
      ) : (
        <>
          {failure ? <Alert tone="error">{failure}</Alert> : null}
          <form onSubmit={onSubmit} noValidate>
            <TextField ref={emailRef} label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} error={error} />
            <Button type="submit" busy={busy}>
              Send reset link
            </Button>
          </form>
        </>
      )}
      <p>
        <Link to="/login">Back to sign in</Link>
      </p>
    </AuthLayout>
  );
}
