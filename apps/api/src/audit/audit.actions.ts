export const AUDIT_ACTIONS = [
  'auth.login.succeeded',
  'auth.login.failed',
  'auth.logout',
  'auth.logout_all',
  'auth.refresh.reuse_detected',
  'auth.password.changed',
  'auth.password.reset_requested',
  'auth.password.reset_completed',
  'invite.created',
  'invite.resent',
  'invite.cancelled',
  'invite.accepted',
  'user.deactivated',
  'user.reactivated',
  'user.role_changed',
  'audit.viewed',
  'audit.exported',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
