export interface NavItem {
  to: string;
  label: string;
  group: 'main' | 'admin' | 'account';
  adminOnly?: boolean;
  end?: boolean;
}

// Pages appear here only once they exist. Later tasks append their entries.
export const NAV_ITEMS: NavItem[] = [{ to: '/', label: 'Dashboard', group: 'main', end: true }];

export const NAV_GROUPS: { id: NavItem['group']; label: string | null }[] = [
  { id: 'main', label: null },
  { id: 'admin', label: 'Admin' },
  { id: 'account', label: 'Account' },
];
