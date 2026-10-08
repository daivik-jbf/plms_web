import { AUDIT_ACTIONS } from './audit.actions';
import { categoryOf, presentAudit, type PresentableEntry } from './audit-presentation';

const base: PresentableEntry = {
  action: 'auth.login.succeeded',
  source: 'portal',
  actorLabel: 'anita@jbf.org',
  actorName: 'Anita Rao',
  targetLabel: 'ben@jbf.org',
  targetName: 'Ben Okoye',
  changes: null,
  metadata: null,
};

const present = (overrides: Partial<PresentableEntry>) => presentAudit({ ...base, ...overrides });

describe('presentAudit', () => {
  it.each([
    ['auth.login.succeeded', {}, 'Signed in', 'success', 'Anita Rao signed in from the portal'],
    ['auth.login.succeeded', { source: 'mobile' }, 'Signed in', 'success', 'Anita Rao signed in from the app'],
    [
      'auth.login.failed',
      { actorName: null, actorLabel: 'dev@jbf.org', metadata: { reason: 'wrong_password', locked: false } },
      'Sign-in failed',
      'warning',
      'Failed sign-in for dev@jbf.org (wrong password)',
    ],
    [
      'auth.login.failed',
      { actorName: null, actorLabel: 'dev@jbf.org', metadata: { reason: 'wrong_password', locked: true } },
      'Sign-in failed',
      'warning',
      'Failed sign-in for dev@jbf.org (wrong password, account now locked)',
    ],
    [
      'auth.login.failed',
      { actorName: null, actorLabel: 'ghost@jbf.org', metadata: { reason: 'unknown_email' } },
      'Sign-in failed',
      'warning',
      'Failed sign-in for ghost@jbf.org (no account with that email)',
    ],
    ['auth.login.failed', { actorName: null, actorLabel: 'x@jbf.org' }, 'Sign-in failed', 'warning', 'Failed sign-in for x@jbf.org'],
    ['auth.logout', {}, 'Signed out', 'neutral', 'Anita Rao signed out'],
    ['auth.logout_all', {}, 'Signed out everywhere', 'neutral', 'Anita Rao signed out of all devices'],
    [
      'auth.refresh.reuse_detected',
      {},
      'Session reuse detected',
      'warning',
      "Anita Rao's session was ended because an old session token was used again",
    ],
    ['auth.password.changed', {}, 'Password changed', 'change', 'Anita Rao changed their password'],
    ['auth.password.reset_requested', {}, 'Password reset requested', 'neutral', 'Anita Rao requested a password reset'],
    ['auth.password.reset_completed', {}, 'Password reset', 'change', 'Anita Rao reset their password'],
    [
      'invite.created',
      { targetName: null, metadata: { role: 'staff' } },
      'Invite sent',
      'change',
      'Anita Rao invited ben@jbf.org as Staff',
    ],
    ['invite.resent', { targetName: null }, 'Invite resent', 'change', 'Anita Rao resent the invite to ben@jbf.org'],
    ['invite.cancelled', { targetName: null }, 'Invite cancelled', 'danger', 'Anita Rao cancelled the invite for ben@jbf.org'],
    [
      'invite.accepted',
      { actorName: 'Ben Okoye', actorLabel: 'ben@jbf.org' },
      'Invite accepted',
      'success',
      'Ben Okoye accepted their invite and joined',
    ],
    [
      'user.role_changed',
      { changes: { role: { before: 'staff', after: 'admin' } } },
      'Role changed',
      'change',
      "Anita Rao changed Ben Okoye's role from Staff to Admin",
    ],
    ['user.deactivated', {}, 'Deactivated', 'danger', 'Anita Rao deactivated Ben Okoye'],
    ['user.reactivated', {}, 'Reactivated', 'success', 'Anita Rao reactivated Ben Okoye'],
    ['audit.viewed', {}, 'Viewed audit log', 'neutral', 'Anita Rao opened the audit log'],
    ['audit.exported', { metadata: { rowCount: 42 } }, 'Exported audit log', 'neutral', 'Anita Rao exported 42 audit log rows'],
    ['audit.exported', { metadata: { rowCount: 1 } }, 'Exported audit log', 'neutral', 'Anita Rao exported 1 audit log row'],
    ['audit.exported', { metadata: { filters: {} } }, 'Exported audit log', 'neutral', 'Anita Rao exported audit log rows'],
    [
      'auth.login.failed',
      { actorName: null, actorLabel: 'x@jbf.org', metadata: { reason: 'cosmic_rays' } },
      'Sign-in failed',
      'warning',
      'Failed sign-in for x@jbf.org',
    ],
    [
      'auth.login.failed',
      { actorName: null, actorLabel: 'x@jbf.org', metadata: { locked: true } },
      'Sign-in failed',
      'warning',
      'Failed sign-in for x@jbf.org',
    ],
    ['invite.created', { targetName: null, metadata: {} }, 'Invite sent', 'change', 'Anita Rao invited ben@jbf.org as unknown'],
  ] as const)('%s %j', (action, overrides, label, tone, summary) => {
    const result = present({ action, ...overrides } as Partial<PresentableEntry>);
    expect(result).toEqual({ label, tone, category: 'accounts', summary });
  });

  it('covers every known action with a specific presentation (no generic fallback)', () => {
    for (const action of AUDIT_ACTIONS) {
      const result = present({ action });
      expect(result.label).not.toBe(action);
      expect(result.summary).not.toMatch(/performed/);
    }
  });

  it('names the system when there is no actor', () => {
    const result = present({ action: 'invite.created', actorName: null, actorLabel: null, targetName: null, metadata: { role: 'admin' } });
    expect(result.summary).toBe('The system invited ben@jbf.org as Admin');
  });

  it('falls back to labels when names are unknown and to "someone" when there is no target', () => {
    expect(present({ action: 'user.deactivated', actorName: null, targetName: null }).summary).toBe('anita@jbf.org deactivated ben@jbf.org');
    expect(present({ action: 'user.deactivated', targetName: null, targetLabel: null }).summary).toBe('Anita Rao deactivated someone');
  });

  it('shows "unknown" for a role change with missing before/after values', () => {
    expect(present({ action: 'user.role_changed', changes: null }).summary).toBe(
      "Anita Rao changed Ben Okoye's role from unknown to unknown",
    );
  });

  it('presents an unknown future action without failing', () => {
    expect(present({ action: 'content.created' })).toEqual({
      label: 'content.created',
      tone: 'neutral',
      category: 'content',
      summary: 'Anita Rao performed content.created',
    });
    expect(present({ action: 'playback.played' }).category).toBe('playback');
  });
});

describe('presentAudit with Object member names', () => {
  const inherited = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'];

  it.each(inherited)('uses the generic fallback for the action %j', (action) => {
    expect(present({ action })).toEqual({
      label: action,
      tone: 'neutral',
      category: 'accounts',
      summary: `Anita Rao performed ${action}`,
    });
  });

  it.each(inherited)('shows no reason text for the failure reason %j', (reason) => {
    expect(present({ action: 'auth.login.failed', metadata: { reason, locked: true } }).summary).toBe('Failed sign-in for Anita Rao');
  });
});

describe('categoryOf', () => {
  it.each([
    ['auth.login.succeeded', 'accounts'],
    ['invite.created', 'accounts'],
    ['user.role_changed', 'accounts'],
    ['audit.viewed', 'accounts'],
    ['content.deleted', 'content'],
    ['file.uploaded', 'files'],
    ['playback.played', 'playback'],
    ['download.completed', 'playback'],
    ['something', 'accounts'],
  ])('%s -> %s', (action, category) => {
    expect(categoryOf(action)).toBe(category);
  });
});
