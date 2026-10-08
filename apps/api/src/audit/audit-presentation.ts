import type { AuditChanges } from '../db/schema';
import type { AuditAction } from './audit.actions';

export type AuditTone = 'change' | 'danger' | 'warning' | 'success' | 'neutral';
export type AuditCategory = 'accounts' | 'content' | 'files' | 'playback';

export interface PresentableEntry {
  action: string;
  source: string;
  actorLabel: string | null;
  actorName: string | null;
  targetLabel: string | null;
  targetName: string | null;
  changes: AuditChanges | null;
  metadata: Record<string, unknown> | null;
}

export interface Presentation {
  label: string;
  tone: AuditTone;
  category: AuditCategory;
  summary: string;
}

// 'accounts' is every action that does not start with one of these prefixes.
export const CATEGORY_PREFIXES = {
  content: ['content'],
  files: ['file'],
  playback: ['playback', 'download'],
} as const;

export function categoryOf(action: string): AuditCategory {
  const prefix = action.split('.')[0] ?? '';
  if ((CATEGORY_PREFIXES.content as readonly string[]).includes(prefix)) return 'content';
  if ((CATEGORY_PREFIXES.files as readonly string[]).includes(prefix)) return 'files';
  if ((CATEGORY_PREFIXES.playback as readonly string[]).includes(prefix)) return 'playback';
  return 'accounts';
}

interface Context {
  actor: string;
  target: string;
  entry: PresentableEntry;
}

interface ActionSpec {
  label: string;
  tone: AuditTone;
  summary: (context: Context) => string;
}

const roleLabel = (value: unknown): string => {
  if (value === 'admin') return 'Admin';
  if (value === 'staff') return 'Staff';
  return String(value ?? 'unknown');
};

const FAILURE_REASONS: Record<string, string> = {
  unknown_email: 'no account with that email',
  wrong_password: 'wrong password',
  locked: 'account is locked',
  deactivated: 'account is deactivated',
};

function failedSignIn({ entry }: Context): string {
  const who = entry.actorName ?? entry.actorLabel ?? 'an unknown email';
  const code = entry.metadata?.reason;
  // Own keys only: a stored reason such as 'constructor' must not pick up an inherited Object member.
  const reason = typeof code === 'string' && Object.hasOwn(FAILURE_REASONS, code) ? FAILURE_REASONS[code] : undefined;
  if (!reason) return `Failed sign-in for ${who}`;
  const lockedNow = entry.metadata?.locked === true ? ', account now locked' : '';
  return `Failed sign-in for ${who} (${reason}${lockedNow})`;
}

function exportedRows({ actor, entry }: Context): string {
  const count = entry.metadata?.rowCount;
  if (typeof count !== 'number') return `${actor} exported audit log rows`;
  return `${actor} exported ${count} audit log row${count === 1 ? '' : 's'}`;
}

const SPECS: Record<AuditAction, ActionSpec> = {
  'auth.login.succeeded': {
    label: 'Signed in',
    tone: 'success',
    summary: ({ actor, entry }) => `${actor} signed in from the ${entry.source === 'mobile' ? 'app' : 'portal'}`,
  },
  'auth.login.failed': { label: 'Sign-in failed', tone: 'warning', summary: failedSignIn },
  'auth.logout': { label: 'Signed out', tone: 'neutral', summary: ({ actor }) => `${actor} signed out` },
  'auth.logout_all': {
    label: 'Signed out everywhere',
    tone: 'neutral',
    summary: ({ actor }) => `${actor} signed out of all devices`,
  },
  'auth.refresh.reuse_detected': {
    label: 'Session reuse detected',
    tone: 'warning',
    summary: ({ actor }) => `${actor}'s session was ended because an old session token was used again`,
  },
  'auth.password.changed': {
    label: 'Password changed',
    tone: 'change',
    summary: ({ actor }) => `${actor} changed their password`,
  },
  'auth.password.reset_requested': {
    label: 'Password reset requested',
    tone: 'neutral',
    summary: ({ actor }) => `${actor} requested a password reset`,
  },
  'auth.password.reset_completed': {
    label: 'Password reset',
    tone: 'change',
    summary: ({ actor }) => `${actor} reset their password`,
  },
  'invite.created': {
    label: 'Invite sent',
    tone: 'change',
    summary: ({ actor, target, entry }) => `${actor} invited ${target} as ${roleLabel(entry.metadata?.role)}`,
  },
  'invite.resent': {
    label: 'Invite resent',
    tone: 'change',
    summary: ({ actor, target }) => `${actor} resent the invite to ${target}`,
  },
  'invite.cancelled': {
    label: 'Invite cancelled',
    tone: 'danger',
    summary: ({ actor, target }) => `${actor} cancelled the invite for ${target}`,
  },
  'invite.accepted': {
    label: 'Invite accepted',
    tone: 'success',
    summary: ({ actor }) => `${actor} accepted their invite and joined`,
  },
  'user.role_changed': {
    label: 'Role changed',
    tone: 'change',
    summary: ({ actor, target, entry }) =>
      `${actor} changed ${target}'s role from ${roleLabel(entry.changes?.role?.before)} to ${roleLabel(entry.changes?.role?.after)}`,
  },
  'user.deactivated': {
    label: 'Deactivated',
    tone: 'danger',
    summary: ({ actor, target }) => `${actor} deactivated ${target}`,
  },
  'user.reactivated': {
    label: 'Reactivated',
    tone: 'success',
    summary: ({ actor, target }) => `${actor} reactivated ${target}`,
  },
  'audit.viewed': {
    label: 'Viewed audit log',
    tone: 'neutral',
    summary: ({ actor }) => `${actor} opened the audit log`,
  },
  'audit.exported': { label: 'Exported audit log', tone: 'neutral', summary: exportedRows },
};

export function presentAudit(entry: PresentableEntry): Presentation {
  const context: Context = {
    actor: entry.actorName ?? entry.actorLabel ?? 'The system',
    target: entry.targetName ?? entry.targetLabel ?? 'someone',
    entry,
  };
  const category = categoryOf(entry.action);
  // Own keys only: an action such as 'toString' or '__proto__' must fall back, not pick up an inherited Object member.
  const spec = Object.hasOwn(SPECS, entry.action) ? (SPECS as Record<string, ActionSpec>)[entry.action] : undefined;
  if (!spec) {
    return { label: entry.action, tone: 'neutral', category, summary: `${context.actor} performed ${entry.action}` };
  }
  return { label: spec.label, tone: spec.tone, category, summary: spec.summary(context) };
}
