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
    expect(course).toEqual([
      'content.course.created',
      'content.course.edited',
      'content.course.reordered',
      'content.course.cover_set',
      'content.course.deleted',
      'content.course.restored',
      'content.course.purged',
    ]);
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
    ['content.lesson.edited', { targetLabel: 'Exits' }, 'Lesson edited', 'change', "Anita Rao edited the lesson 'Exits'"],
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
    expect(structure).toHaveLength(15);
    expect(structure.every((action) => categoryOf(action) === 'content')).toBe(true);
  });
});

describe('Trash audit presentation', () => {
  it.each([
    ['content.course.deleted', 'Course deleted', 'danger', "Anita Rao moved the course 'Fire safety' to the Trash"],
    ['content.course.restored', 'Course restored', 'success', "Anita Rao restored the course 'Fire safety' from the Trash"],
    ['content.course.purged', 'Course deleted for good', 'danger', "Anita Rao deleted the course 'Fire safety' for good"],
    ['content.lesson.deleted', 'Lesson deleted', 'danger', "Anita Rao moved the lesson 'Fire safety' to the Trash"],
    ['content.lesson.restored', 'Lesson restored', 'success', "Anita Rao restored the lesson 'Fire safety' from the Trash"],
    ['content.lesson.purged', 'Lesson deleted for good', 'danger', "Anita Rao deleted the lesson 'Fire safety' for good"],
    ['content.topic.deleted', 'Topic deleted', 'danger', "Anita Rao moved the topic 'Fire safety' to the Trash"],
    ['content.topic.restored', 'Topic restored', 'success', "Anita Rao restored the topic 'Fire safety' from the Trash"],
    ['content.topic.purged', 'Topic deleted for good', 'danger', "Anita Rao deleted the topic 'Fire safety' for good"],
    ['content.attachment.deleted', 'Attachment deleted', 'danger', "Anita Rao moved the attachment 'Fire safety' to the Trash"],
    ['content.attachment.restored', 'Attachment restored', 'success', "Anita Rao restored the attachment 'Fire safety' from the Trash"],
    ['content.attachment.purged', 'Attachment deleted for good', 'danger', "Anita Rao deleted the attachment 'Fire safety' for good"],
  ] as const)('%s', (action, label, tone, summary) => {
    expect(presentAudit(entry({ action, targetLabel: 'Fire safety' }))).toEqual({ label, tone, category: 'content', summary });
  });
});

describe('attachment audit presentation', () => {
  it.each([
    ['pdf', 'PDF'],
    ['video', 'video'],
    ['audio', 'audio file'],
    ['image', 'image'],
  ])('says "%s" as "%s"', (kind, word) => {
    const added = presentAudit(entry({ action: 'content.attachment.added', targetLabel: 'Exit map', metadata: { kind, topicTitle: 'Fire exits' } }));
    expect(added).toEqual({
      label: 'Attachment added',
      tone: 'change',
      category: 'content',
      summary: `Anita Rao added the ${word} 'Exit map' to the topic 'Fire exits'`,
    });
    expect(presentAudit(entry({ action: 'playback.viewed', targetLabel: 'Exit map', metadata: { kind } })).summary).toBe(`Anita Rao opened the ${word} 'Exit map'`);
  });

  it('falls back to "attachment" and leaves out a topic that was not recorded', () => {
    for (const metadata of [null, {}, { kind: 'constructor' }, { kind: '__proto__' }, { kind: 5 }, { kind: 'spreadsheet', topicTitle: 7 }]) {
      expect(presentAudit(entry({ action: 'content.attachment.added', targetLabel: 'T', metadata })).summary).toBe("Anita Rao added the attachment 'T'");
      expect(presentAudit(entry({ action: 'playback.viewed', targetLabel: 'T', metadata })).summary).toBe("Anita Rao opened the attachment 'T'");
    }
  });

  it.each([
    [
      'content.attachment.renamed',
      { targetLabel: 'Exit map', changes: { title: { before: 'Map', after: 'Exit map' } } },
      'Attachment renamed',
      'change',
      "Anita Rao renamed the attachment from 'Map' to 'Exit map'",
    ],
    ['content.attachment.renamed', { targetLabel: 'Exit map' }, 'Attachment renamed', 'change', "Anita Rao renamed the attachment 'Exit map'"],
    [
      'content.attachment.reordered',
      { targetLabel: 'Fire exits' },
      'Attachments reordered',
      'neutral',
      "Anita Rao changed the order of the attachments in the topic 'Fire exits'",
    ],
  ] as const)('%s', (action, overrides, label, tone, summary) => {
    expect(presentAudit(entry({ action, ...overrides }))).toEqual({ label, tone, category: 'content', summary });
  });

  it('presents viewing as a playback entry', () => {
    expect(presentAudit(entry({ action: 'playback.viewed', targetLabel: 'Exit map', metadata: { kind: 'pdf' } }))).toEqual({
      label: 'Viewed',
      tone: 'neutral',
      category: 'playback',
      summary: "Anita Rao opened the PDF 'Exit map'",
    });
    expect(categoryOf('playback.viewed')).toBe('playback');
  });
});
