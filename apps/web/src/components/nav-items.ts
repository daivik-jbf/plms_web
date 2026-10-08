export interface NavItem {
  to: string;
  label: string;
  group: 'main' | 'admin' | 'account';
  adminOnly?: boolean;
  end?: boolean;
}

// Pages appear here only once they exist. Later tasks append their entries.
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', group: 'main', end: true },
  { to: '/staff', label: 'Staff', group: 'admin', adminOnly: true },
  { to: '/audit', label: 'Audit log', group: 'admin', adminOnly: true },
  { to: '/account', label: 'My account', group: 'account' },
];

export const NAV_GROUPS: { id: NavItem['group']; label: string | null }[] = [
  { id: 'main', label: null },
  { id: 'admin', label: 'Admin' },
  { id: 'account', label: 'Account' },
];
