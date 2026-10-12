import { z } from 'zod';
import { descriptionSchema, titleSchema } from '../media/media.schemas';

// A course has a title (1 to 200) and a description of at most 2,000 characters; an empty description means none.
export const createCourseSchema = z.object({ title: titleSchema, description: descriptionSchema.nullish() });

export const updateCourseSchema = z
  .object({ title: titleSchema.optional(), description: descriptionSchema.nullable().optional() })
  .refine((value) => value.title !== undefined || value.description !== undefined, { message: 'Nothing to change.' });

export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
