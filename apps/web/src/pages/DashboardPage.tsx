import { useAuth } from '../auth/AuthContext';

export function DashboardPage() {
  const { state } = useAuth();
  if (state.status !== 'authenticated') return null;

  return (
    <>
      <h1>Welcome, {state.user.name}</h1>
      <p>Your library will appear here as soon as content features arrive in the next milestones.</p>
    </>
  );
}
