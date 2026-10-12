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

describe('lesson and topic audit presentation', () => {
  it.each([
    [
      'content.lesson.added',
      { targetLabel: 'Exits', metadata: { courseTitle: 'Fire safety' } },
      'Lesson added',
      'change',
      "Anita Rao added the lesson 'Exits' to the course 'Fire safety'",
    ],
    ['content.lesson.added', { targetLabel: 'Exits' }, 'Lesson added', 'change', "Anita Rao added the lesson 'Exits'"],
    [
      'content.lesson.renamed',
      { targetLabel: 'Exits', changes: { title: { before: 'Exist', after: 'Exits' } } },
      'Lesson renamed',
      'change',
      "Anita Rao renamed the lesson from 'Exist' to 'Exits'",
    ],
    ['content.lesson.renamed', { targetLabel: 'Exits' }, 'Lesson renamed', 'change', "Anita Rao renamed the lesson 'Exits'"],
    ['content.lesson.reordered', { targetLabel: 'Fire safety' }, 'Lessons reordered', 'neutral', "Anita Rao changed the order of the lessons in the course 'Fire safety'"],
    [
      'content.topic.added',
      { targetLabel: 'Fire exits', metadata: { lessonTitle: 'Exits' } },
      'Topic added',
      'change',
      "Anita Rao added the topic 'Fire exits' to the lesson 'Exits'",
    ],
    ['content.topic.added', { targetLabel: 'Fire exits' }, 'Topic added', 'change', "Anita Rao added the topic 'Fire exits'"],
    ['content.topic.edited', { targetLabel: 'Fire exits' }, 'Topic edited', 'change', "Anita Rao edited the topic 'Fire exits'"],
    ['content.topic.reordered', { targetLabel: 'Exits' }, 'Topics reordered', 'neutral', "Anita Rao changed the order of the topics in the lesson 'Exits'"],
  ] as const)('%s', (action, overrides, label, tone, summary) => {
    expect(presentAudit(entry({ action, ...overrides }))).toEqual({ label, tone, category: 'content', summary });
  });

  it('ignores parent names that are not text, including inherited object members', () => {
    for (const courseTitle of [5, null, { x: 1 }, undefined]) {
      expect(presentAudit(entry({ action: 'content.lesson.added', targetLabel: 'L', metadata: { courseTitle } })).summary).toBe("Anita Rao added the lesson 'L'");
    }
    expect(presentAudit(entry({ action: 'content.lesson.renamed', targetLabel: 'L', changes: { title: { before: 1, after: 'L' } } })).summary).toBe("Anita Rao renamed the lesson 'L'");
  });

  it('files the lesson and topic actions under content', () => {
    const structure = AUDIT_ACTIONS.filter((action) => /^content\.(lesson|topic)\./.test(action));
    expect(structure).toHaveLength(6);
    expect(structure.every((action) => categoryOf(action) === 'content')).toBe(true);
  });
});
