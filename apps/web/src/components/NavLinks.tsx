import { NavLink } from 'react-router-dom';
import type { User } from '../api/auth';
import styles from './NavLinks.module.css';
import { NAV_GROUPS, NAV_ITEMS } from './nav-items';

export function NavLinks({ role, onNavigate }: { role: User['role']; onNavigate?: () => void }) {
  const visible = NAV_ITEMS.filter((item) => !item.adminOnly || role === 'admin');
  return (
    <nav aria-label="Main">
      {NAV_GROUPS.map((group) => {
        const items = visible.filter((item) => item.group === group.id);
        if (items.length === 0) return null;
        return (
          <div key={group.id} className={styles.group}>
            {group.label ? <p className={styles.groupLabel}>{group.label}</p> : null}
            <ul className={styles.list}>
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
