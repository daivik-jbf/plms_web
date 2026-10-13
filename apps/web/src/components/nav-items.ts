import type { IconName } from './Icon';
import { CATEGORIES } from '../media/categories';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  group: 'main' | 'admin' | 'account';
  adminOnly?: boolean;
  end?: boolean;
}

// Pages appear here only once they exist. Later tasks append their entries.
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'home', group: 'main', end: true },
  { to: '/courses', label: 'Courses', icon: 'courses', group: 'main' },
  ...CATEGORIES.map((category): NavItem => ({ to: `/${category.slug}`, label: category.label, icon: category.icon, group: 'main' })),
  { to: '/staff', label: 'Staff', icon: 'staff', group: 'admin', adminOnly: true },
  { to: '/audit', label: 'Audit Log', icon: 'audit', group: 'admin', adminOnly: true },
  { to: '/trash', label: 'Trash', icon: 'trash', group: 'admin', adminOnly: true },
  { to: '/account', label: 'My Account', icon: 'account', group: 'account' },
];

export const NAV_GROUPS: { id: NavItem['group']; label: string | null }[] = [
  { id: 'main', label: null },
  { id: 'admin', label: 'Admin' },
  { id: 'account', label: 'Account' },
];
