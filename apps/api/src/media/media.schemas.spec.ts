import { descriptionSchema, folderNameSchema, startAttachmentUploadSchema, startUploadSchema, titleSchema } from './media.schemas';

const validUpload = {
  folderId: '00000000-0000-4000-8000-000000000000',
  title: 'A title',
  fileName: 'clip.mp4',
  contentType: 'video/mp4',
  sizeBytes: 1024,
};

describe('media schemas and NUL characters', () => {
  it.each([
    ['folder name', folderNameSchema, 100],
    ['title', titleSchema, 200],
    ['description', descriptionSchema, 2000],
  ])('%s refuses NUL and accepts normal and exactly-max-length text', (_label, schema, max) => {
    expect(schema.safeParse('a\u0000b').success).toBe(false);
    expect(schema.safeParse('\u0000').success).toBe(false);
    expect(schema.safeParse('Normal text').success).toBe(true);
    expect(schema.safeParse('x'.repeat(max)).success).toBe(true);
    expect(schema.safeParse('x'.repeat(max + 1)).success).toBe(false);
  });

  it('a description may still be empty, meaning none', () => {
    expect(descriptionSchema.parse('   ')).toBeNull();
  });

  it('the upload file name refuses NUL and accepts a normal name', () => {
    expect(startUploadSchema.safeParse({ ...validUpload, fileName: 'a\u0000.mp4' }).success).toBe(false);
    expect(startUploadSchema.safeParse(validUpload).success).toBe(true);
  });

  it('leaves the allowed type and size to the folder, but refuses a missing or NUL type and an empty file', () => {
    expect(startUploadSchema.safeParse({ ...validUpload, contentType: 'audio/mpeg', sizeBytes: 524_288_001 }).success).toBe(true);
    expect(startUploadSchema.safeParse({ ...validUpload, sizeBytes: 3 * 1024 ** 3 }).success).toBe(true);
    expect(startUploadSchema.safeParse({ ...validUpload, contentType: '' }).success).toBe(false);
    expect(startUploadSchema.safeParse({ ...validUpload, contentType: 'audio/mpeg\u0000' }).success).toBe(false);
    expect(startUploadSchema.safeParse({ ...validUpload, sizeBytes: 0 }).success).toBe(false);
    expect(startUploadSchema.safeParse({ ...validUpload, sizeBytes: 2 ** 60 }).success).toBe(false);
  });
});

describe('the attachment upload schema', () => {
  const valid = { fileName: 'map.pdf', contentType: 'application/pdf', sizeBytes: 10 };

  it('needs no title and accepts the longest one and a length', () => {
    expect(startAttachmentUploadSchema.safeParse(valid).success).toBe(true);
    expect(startAttachmentUploadSchema.safeParse({ ...valid, title: 'T'.repeat(200), durationSeconds: 90 }).success).toBe(true);
  });

  it.each([
    ['an empty title', { title: '' }],
    ['a title of 201 characters', { title: 'T'.repeat(201) }],
    ['a NUL character in the title', { title: 'a\u0000b' }],
    ['no file name', { fileName: '' }],
    ['a NUL character in the file name', { fileName: 'a\u0000.pdf' }],
    ['no type', { contentType: '' }],
    ['an empty file', { sizeBytes: 0 }],
    ['a fractional size', { sizeBytes: 1.5 }],
    ['a negative length', { durationSeconds: -1 }],
  ])('refuses %s', (_name, bad) => {
    expect(startAttachmentUploadSchema.safeParse({ ...valid, ...bad }).success).toBe(false);
  });

  it('leaves the allowed type and size to the declared kind', () => {
    expect(startAttachmentUploadSchema.safeParse({ ...valid, contentType: 'application/zip', sizeBytes: 3 * 1024 ** 3 }).success).toBe(true);
  });
});
