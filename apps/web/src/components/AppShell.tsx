import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { UploadPanel } from '../uploads/UploadPanel';
import { UploadsProvider } from '../uploads/UploadsContext';
import styles from './AppShell.module.css';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { NavLinks } from './NavLinks';

export function AppShell() {
  const { state, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  if (state.status !== 'authenticated') return null;
  const { user } = state;

  return (
    <UploadsProvider>
      <div className={styles.shell}>
        <aside className={styles.sidebar}>
          <p className={styles.brand}>JBF Learning Management System</p>
          <NavLinks role={user.role} />
        </aside>
        <div className={styles.column}>
          <header className={styles.topBar}>
            <Button variant="secondary" size="small" className={styles.menuButton} onClick={() => setMenuOpen(true)}>
              Menu
            </Button>
            <span className={styles.who}>
              {user.name} · {user.role === 'admin' ? 'Admin' : 'Staff'}
            </span>
            <Button variant="secondary" size="small" onClick={() => void signOut()}>
              Sign out
            </Button>
          </header>
          <main className={styles.main}>
            <Outlet />
          </main>
        </div>
        <Dialog open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu" side="left">
          <NavLinks role={user.role} onNavigate={() => setMenuOpen(false)} />
        </Dialog>
        <UploadPanel />
      </div>
    </UploadsProvider>
  );
}
