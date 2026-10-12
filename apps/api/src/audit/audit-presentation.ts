import type { AuditChanges } from '../db/schema';
import { type CategoryRule, MEDIA_CATEGORIES, type MediaCategory } from '../media/media-kinds';
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

const UPLOAD_FAILURE_REASONS: Record<string, string> = {
  size_mismatch: 'the file size did not match',
  not_mp4: 'the file is not a valid MP4',
  not_audio: 'the file is not a valid MP3 or M4A',
  not_pdf: 'the file is not a valid PDF',
  not_image: 'the file is not a valid JPEG, PNG or WebP image',
  bad_image: 'the cover image is not valid',
  expired: 'it was not finished within 24 hours',
};

function uploadFailed({ target, entry }: Context): string {
  const code = entry.metadata?.reason;
  const reason = typeof code === 'string' && Object.hasOwn(UPLOAD_FAILURE_REASONS, code) ? UPLOAD_FAILURE_REASONS[code] : undefined;
  return reason ? `The upload of ${target} failed (${reason})` : `The upload of ${target} failed`;
}

function folderRenamed({ actor, target, entry }: Context): string {
  const { before, after } = entry.changes?.name ?? {};
  if (typeof before !== 'string' || typeof after !== 'string') return `${actor} renamed the folder ${target}`;
  return `${actor} renamed the folder from ${before} to ${after}`;
}

// Content entries name their category in metadata.category since milestone 4. Older entries have none and are all about
// videos, so they keep reading "the video". Own keys only: a stored value such as 'constructor' falls back too.
function wordsFor(entry: PresentableEntry): CategoryRule {
  const code = entry.metadata?.category;
  return typeof code === 'string' && Object.hasOwn(MEDIA_CATEGORIES, code) ? MEDIA_CATEGORIES[code as MediaCategory] : MEDIA_CATEGORIES.video;
}

const quoted = (text: string): string => `'${text}'`;

// A text value from the entry's metadata, or null when it is missing or not text.
const metaText = (entry: PresentableEntry, key: string): string | null => {
  const value = entry.metadata?.[key];
  return typeof value === 'string' ? value : null;
};

// How an attachment is called in a sentence. Own keys only: a stored kind such as 'constructor' falls back to "attachment".
const ATTACHMENT_WORDS: Record<string, string> = { video: 'video', audio: 'audio file', pdf: 'PDF', image: 'image' };
const attachmentWord = (entry: PresentableEntry): string => {
  const kind = metaText(entry, 'kind');
  return kind !== null && Object.hasOwn(ATTACHMENT_WORDS, kind) ? ATTACHMENT_WORDS[kind] : 'attachment';
};

// "from 'a' to 'b'" for an entry that recorded a change of one text field, or null.
// "from 'a' to 'b'" for an entry that recorded a change of one text field, or null.
const changedText = (entry: PresentableEntry, field: string): { before: string; after: string } | null => {
  const { before, after } = entry.changes?.[field] ?? {};
  return typeof before === 'string' && typeof after === 'string' ? { before, after } : null;
};

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
  'content.folder.created': {
    label: 'Folder created',
    tone: 'change',
    summary: ({ actor, target }) => `${actor} created the folder ${target}`,
  },
  'content.folder.renamed': { label: 'Folder renamed', tone: 'change', summary: folderRenamed },
  'content.folder.reordered': {
    label: 'Folders reordered',
    tone: 'neutral',
    summary: ({ actor, entry }) => `${actor} changed the order of the ${wordsFor(entry).noun} folders`,
  },
  'content.video.added': {
    label: 'Item added',
    tone: 'change',
    summary: ({ actor, target, entry }) => `${actor} added the ${wordsFor(entry).noun} ${target}`,
  },
  'content.video.edited': {
    label: 'Item edited',
    tone: 'change',
    summary: ({ actor, target, entry }) => `${actor} edited the ${wordsFor(entry).noun} ${target}`,
  },
  'content.video.reordered': {
    label: 'Items reordered',
    tone: 'neutral',
    summary: ({ actor, target, entry }) => `${actor} changed the order of the ${wordsFor(entry).nounPlural} in ${target}`,
  },
  'content.video.cover_set': {
    label: 'Cover set',
    tone: 'change',
    summary: ({ actor, target, entry }) => `${actor} set the cover image of the ${wordsFor(entry).noun} ${target}`,
  },
  'content.course.created': {
    label: 'Course created',
    tone: 'change',
    summary: ({ actor, target }) => `${actor} created the course ${quoted(target)}`,
  },
  'content.course.edited': {
    label: 'Course edited',
    tone: 'change',
    summary: ({ actor, target }) => `${actor} edited the course ${quoted(target)}`,
  },
  'content.course.reordered': {
    label: 'Courses reordered',
    tone: 'neutral',
    summary: ({ actor }) => `${actor} changed the order of the courses`,
  },
  'content.course.cover_set': {
    label: 'Course cover set',
    tone: 'change',
    summary: ({ actor, target }) => `${actor} set the cover image of the course ${quoted(target)}`,
  },
  'content.lesson.added': {
    label: 'Lesson added',
    tone: 'change',
    summary: ({ actor, target, entry }) => {
      const course = metaText(entry, 'courseTitle');
      return course ? `${actor} added the lesson ${quoted(target)} to the course ${quoted(course)}` : `${actor} added the lesson ${quoted(target)}`;
    },
  },
  'content.lesson.renamed': {
    label: 'Lesson renamed',
    tone: 'change',
    summary: ({ actor, target, entry }) => {
      const title = changedText(entry, 'title');
      return title ? `${actor} renamed the lesson from ${quoted(title.before)} to ${quoted(title.after)}` : `${actor} renamed the lesson ${quoted(target)}`;
    },
  },
  'content.lesson.reordered': {
    label: 'Lessons reordered',
    tone: 'neutral',
    summary: ({ actor, target }) => `${actor} changed the order of the lessons in the course ${quoted(target)}`,
  },
  'content.topic.added': {
    label: 'Topic added',
    tone: 'change',
    summary: ({ actor, target, entry }) => {
      const lesson = metaText(entry, 'lessonTitle');
      return lesson ? `${actor} added the topic ${quoted(target)} to the lesson ${quoted(lesson)}` : `${actor} added the topic ${quoted(target)}`;
    },
  },
  'content.topic.edited': {
    label: 'Topic edited',
    tone: 'change',
    summary: ({ actor, target }) => `${actor} edited the topic ${quoted(target)}`,
  },
  'content.topic.reordered': {
    label: 'Topics reordered',
    tone: 'neutral',
    summary: ({ actor, target }) => `${actor} changed the order of the topics in the lesson ${quoted(target)}`,
  },
  'content.attachment.added': {
    label: 'Attachment added',
    tone: 'change',
    summary: ({ actor, target, entry }) => {
      const topic = metaText(entry, 'topicTitle');
      const added = `${actor} added the ${attachmentWord(entry)} ${quoted(target)}`;
      return topic ? `${added} to the topic ${quoted(topic)}` : added;
    },
  },
  'content.attachment.renamed': {
    label: 'Attachment renamed',
    tone: 'change',
    summary: ({ actor, target, entry }) => {
      const title = changedText(entry, 'title');
      return title
        ? `${actor} renamed the attachment from ${quoted(title.before)} to ${quoted(title.after)}`
        : `${actor} renamed the attachment ${quoted(target)}`;
    },
  },
  'content.attachment.reordered': {
    label: 'Attachments reordered',
    tone: 'neutral',
    summary: ({ actor, target }) => `${actor} changed the order of the attachments in the topic ${quoted(target)}`,
  },
  'file.upload_started': {
    label: 'Upload started',
    tone: 'neutral',
    summary: ({ actor, target }) => `${actor} started uploading ${target}`,
  },
  'file.upload_completed': {
    label: 'Upload finished',
    tone: 'success',
    summary: ({ actor, target }) => `${actor} finished uploading ${target}`,
  },
  'file.upload_failed': { label: 'Upload failed', tone: 'warning', summary: uploadFailed },
  'file.upload_cancelled': {
    label: 'Upload cancelled',
    tone: 'neutral',
    summary: ({ actor, target }) => `${actor} cancelled the upload of ${target}`,
  },
  'playback.played': {
    label: 'Played',
    tone: 'neutral',
    summary: ({ actor, target }) => `${actor} played ${target}`,
  },
  'playback.viewed': {
    label: 'Viewed',
    tone: 'neutral',
    summary: ({ actor, target, entry }) => `${actor} opened the ${attachmentWord(entry)} ${quoted(target)}`,
  },
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
