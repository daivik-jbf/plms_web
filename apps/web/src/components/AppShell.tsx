import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import type { User } from '../api/auth';
import { useAuth } from '../auth/AuthContext';
import { DockedPlayer } from '../player/DockedPlayer';
import { PlayerProvider, usePlayer } from '../player/PlayerContext';
import { UploadPanel } from '../uploads/UploadPanel';
import { UploadsProvider } from '../uploads/UploadsContext';
import styles from './AppShell.module.css';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { NavLinks } from './NavLinks';

export function AppShell() {
  const { state, signOut } = useAuth();
  // Signing out unmounts everything below: uploads stop and the docked player stops.
  if (state.status !== 'authenticated') return null;
  return (
    <UploadsProvider>
      <PlayerProvider>
        <Shell user={state.user} onSignOut={() => void signOut()} />
      </PlayerProvider>
    </UploadsProvider>
  );
}

function Shell({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  // While the docked player shows, the page gets room at the bottom so the bar never hides the last row.
  const { session } = usePlayer();

  return (
    <div className={session ? `${styles.shell} ${styles.withPlayer}` : styles.shell}>
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
          <Button variant="secondary" size="small" onClick={onSignOut}>
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
      <DockedPlayer />
    </div>
  );
}
