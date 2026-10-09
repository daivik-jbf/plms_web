import { descriptionSchema, folderNameSchema, startUploadSchema, titleSchema } from './media.schemas';

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
});
