import { z } from 'zod';
import { descriptionSchema, hasNoNul, NUL_MESSAGE, titleSchema } from '../media/media.schemas';

// A course has a title (1 to 200) and a description of at most 2,000 characters; an empty description means none.
export const createCourseSchema = z.object({ title: titleSchema, description: descriptionSchema.nullish() });

export const updateCourseSchema = z
  .object({ title: titleSchema.optional(), description: descriptionSchema.nullable().optional() })
  .refine((value) => value.title !== undefined || value.description !== undefined, { message: 'Nothing to change.' });

export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;

export const lessonBodySchema = z.object({ title: titleSchema });

// A topic's text can be longer than a course description: at most 10,000 characters; empty means none.
export const topicDescriptionSchema = z
  .string()
  .trim()
  .max(10_000, 'Description must be 10,000 characters or fewer.')
  .refine(hasNoNul, NUL_MESSAGE)
  .transform((value) => (value === '' ? null : value));

export const createTopicSchema = z.object({ title: titleSchema, description: topicDescriptionSchema.nullish() });

export const updateTopicSchema = z
  .object({ title: titleSchema.optional(), description: topicDescriptionSchema.nullable().optional() })
  .refine((value) => value.title !== undefined || value.description !== undefined, { message: 'Nothing to change.' });

export type LessonInput = z.infer<typeof lessonBodySchema>;
export type CreateTopicInput = z.infer<typeof createTopicSchema>;
export type UpdateTopicInput = z.infer<typeof updateTopicSchema>;
