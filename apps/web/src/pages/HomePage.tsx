import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/Button';
import styles from './HomePage.module.css';

export function HomePage() {
  const { state, signOut } = useAuth();
  if (state.status !== 'authenticated') return null;

  return (
    <>
      <header className={styles.bar}>
        <p className={styles.brand}>JBF Learning Management System</p>
        <div className={styles.who}>
          <span>
            {state.user.name} ({state.user.role === 'admin' ? 'Admin' : 'Staff'})
          </span>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>
      <main className={styles.content}>
        <h1>Welcome, {state.user.name}</h1>
        <p>Your library will appear here as soon as content features arrive in the next milestones.</p>
      </main>
    </>
  );
}
