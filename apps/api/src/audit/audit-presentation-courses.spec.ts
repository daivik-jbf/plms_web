import { AUDIT_ACTIONS } from './audit.actions';
import { categoryOf, type PresentableEntry, presentAudit } from './audit-presentation';

const entry = (overrides: Partial<PresentableEntry>): PresentableEntry => ({
  action: 'x',
  source: 'portal',
  actorLabel: 'anita@example.org',
  actorName: 'Anita Rao',
  targetLabel: null,
  targetName: null,
  changes: null,
  metadata: null,
  ...overrides,
});

describe('course audit presentation', () => {
  it.each([
    ['content.course.created', { targetLabel: 'Fire safety' }, 'Course created', 'change', "Anita Rao created the course 'Fire safety'"],
    ['content.course.edited', { targetLabel: 'Fire safety' }, 'Course edited', 'change', "Anita Rao edited the course 'Fire safety'"],
    ['content.course.reordered', { targetLabel: 'Courses' }, 'Courses reordered', 'neutral', 'Anita Rao changed the order of the courses'],
    ['content.course.cover_set', { targetLabel: 'Fire safety' }, 'Course cover set', 'change', "Anita Rao set the cover image of the course 'Fire safety'"],
  ] as const)('%s', (action, overrides, label, tone, summary) => {
    expect(presentAudit(entry({ action, ...overrides }))).toEqual({ label, tone, category: 'content', summary });
  });

  it('keeps hostile titles as plain text inside the quotes', () => {
    expect(presentAudit(entry({ action: 'content.course.created', targetLabel: '<b>x</b>\' OR 1=1' })).summary).toBe("Anita Rao created the course '<b>x</b>' OR 1=1'");
  });

  it('files the course actions under content', () => {
    const course = AUDIT_ACTIONS.filter((action) => action.startsWith('content.course.'));
    expect(course).toEqual(['content.course.created', 'content.course.edited', 'content.course.reordered', 'content.course.cover_set']);
    expect(course.every((action) => categoryOf(action) === 'content')).toBe(true);
  });
});
