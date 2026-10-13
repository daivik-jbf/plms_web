import { type FormEvent, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import type { User } from '../api/auth';
import { useAuth } from '../auth/AuthContext';
import { DockedPlayer } from '../player/DockedPlayer';
import { PlayerProvider, usePlayer } from '../player/PlayerContext';
import { UploadPanel } from '../uploads/UploadPanel';
import { UploadsProvider } from '../uploads/UploadsContext';
import styles from './AppShell.module.css';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
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
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  function search(event: FormEvent) {
    event.preventDefault();
    const text = query.trim();
    void navigate(text ? `/courses?q=${encodeURIComponent(text)}` : '/courses');
  }

  return (
    <div className={session ? `${styles.shell} ${styles.withPlayer}` : styles.shell}>
      <aside className={styles.sidebar}>
        <p className={styles.brand}>
          <svg className={styles.brandMark} width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5zM12 6.5v13" />
          </svg>
          <span>
            <span className={styles.brandName}>JBF Learning</span>
            <span className={styles.brandSub}>Management System</span>
          </span>
        </p>
        <div className={styles.nav}>
          <NavLinks role={user.role} />
        </div>
        <p className={styles.tagline}>Learn &nbsp;•&nbsp; Grow &nbsp;•&nbsp; Serve</p>
      </aside>
      <div className={styles.column}>
        <header className={styles.topBar}>
          <Button variant="secondary" size="small" className={styles.menuButton} onClick={() => setMenuOpen(true)}>
            Menu
          </Button>
          <form role="search" className={styles.search} onSubmit={search}>
            <span className={styles.searchIcon}>
              <Icon name="search" />
            </span>
            <input type="search" className={styles.searchInput} aria-label="Search courses" placeholder="Search courses..." value={query} onChange={(event) => setQuery(event.target.value)} />
          </form>
          <span className={styles.who}>
            <span className={styles.avatar} aria-hidden="true">
              {user.name.trim().charAt(0).toUpperCase()}
            </span>
            <span>
              {user.name} · {user.role === 'admin' ? 'Admin' : 'Staff'}
            </span>
          </span>
          <Button variant="secondary" className={styles.signOut} onClick={onSignOut}>
            <Icon name="signout" />
            Sign out
          </Button>
        </header>
        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
      <Dialog open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu" side="left">
        <div className={styles.drawerNav}>
          <NavLinks role={user.role} onNavigate={() => setMenuOpen(false)} />
        </div>
      </Dialog>
      <UploadPanel />
      <DockedPlayer />
    </div>
  );
}
