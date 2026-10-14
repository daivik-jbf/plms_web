import { api } from './client';
import { type MediaCategory, uploadCoverTo } from './media';

export interface CourseSummary {
  id: string;
  title: string;
  description: string | null;
  position: number;
  coverUrl: string | null;
  lessonCount: number;
  topicCount: number;
  createdBy: { id: string; name: string };
  createdAt: string;
}

export interface TopicSummary {
  id: string;
  title: string;
  position: number;
  // A one-hour link to the cover image; missing or null when there is none.
  coverUrl?: string | null;
  // Ready attachments only.
  attachmentCount: number;
  // The same files, in order, for the tree to list under the topic; missing when there are none.
  attachments?: AttachmentSummary[];
}

export interface AttachmentSummary {
  id: string;
  kind: AttachmentKind;
  title: string;
}

export interface LessonNode {
  id: string;
  title: string;
  // The text about the lesson; missing or null when there is none.
  description?: string | null;
  position: number;
  coverUrl?: string | null;
  topics: TopicSummary[];
}

// The whole course in one answer: its lessons in order, each with its topics in order.
export interface CourseTree {
  id: string;
  title: string;
  description: string | null;
  position: number;
  coverUrl: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
  lessons: LessonNode[];
}

export interface TopicView {
  id: string;
  lessonId: string;
  courseId: string;
  title: string;
  description: string | null;
  position: number;
  coverUrl?: string | null;
}

export type AttachmentKind = 'video' | 'audio' | 'pdf' | 'image';

export interface Attachment {
  id: string;
  topicId: string;
  position: number;
  kind: AttachmentKind;
  title: string;
  // The text about the file; missing or null when there is none.
  description?: string | null;
  // Uploaded into the topic, or picked from the library (and then following the library item).
  source: 'upload' | 'library';
  status: 'uploading' | 'ready';
  sizeBytes: number;
  durationSeconds: number | null;
  // A one-hour link to a small picture: a library item's cover, or the uploaded image itself.
  thumbnailUrl: string | null;
  libraryItemId: string | null;
  category: MediaCategory | null;
  libraryFolderName: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
}

// A topic with the attachments the person may see: every ready one, and their own that are still uploading.
export interface TopicDetail extends TopicView {
  attachments: Attachment[];
}

export interface OpenLink {
  url: string;
  expiresAt: string;
  contentType: string;
  kind: AttachmentKind;
}

export const listCourses = (): Promise<CourseSummary[]> => api<CourseSummary[]>('/api/courses');

export const createCourse = (input: { title: string; description: string }): Promise<CourseSummary> =>
  api<CourseSummary>('/api/courses', { method: 'POST', body: input });

export const reorderCourses = (ids: string[]): Promise<CourseSummary[]> =>
  api<CourseSummary[]>('/api/courses/order', { method: 'PUT', body: { ids } });

export const updateCourse = (id: string, input: { title?: string; description?: string }): Promise<CourseTree> =>
  api<CourseTree>(`/api/courses/${id}`, { method: 'PATCH', body: input });


export const getCourse = (id: string): Promise<CourseTree> => api<CourseTree>(`/api/courses/${id}`);

export const getTopic = (id: string): Promise<TopicDetail> => api<TopicDetail>(`/api/topics/${id}`);

export const uploadCourseCover = (id: string, file: File): Promise<CourseTree> => uploadCoverTo<CourseTree>(`/api/courses/${id}`, file);


export const addLesson = (courseId: string, title: string, description?: string): Promise<CourseTree> =>
  api<CourseTree>(`/api/courses/${courseId}/lessons`, { method: 'POST', body: description ? { title, description } : { title } });

// A new lesson with its cover picture. The lesson is made first, so a cover that fails to upload leaves the lesson in place: the
// answer is the tree as it now is, and the reason the cover is missing (null when all went well).
export async function addLessonWithCover(
  tree: CourseTree,
  title: string,
  description: string,
  cover: File | null,
): Promise<{ tree: CourseTree; coverFailure: unknown }> {
  const known = new Set(tree.lessons.map((lesson) => lesson.id));
  const added = await addLesson(tree.id, title, description);
  const created = added.lessons.find((lesson) => !known.has(lesson.id));
  if (!cover || !created) return { tree: added, coverFailure: null };
  try {
    return { tree: await uploadLessonCover(created.id, cover), coverFailure: null };
  } catch (coverFailure) {
    return { tree: added, coverFailure };
  }
}

export const updateLesson = (id: string, input: { title?: string; description?: string }): Promise<CourseTree> =>
  api<CourseTree>(`/api/lessons/${id}`, { method: 'PATCH', body: input });

export const reorderLessons = (courseId: string, ids: string[]): Promise<CourseTree> =>
  api<CourseTree>(`/api/courses/${courseId}/lessons/order`, { method: 'PUT', body: { ids } });

export const addTopic = (lessonId: string, title: string, description?: string): Promise<CourseTree> =>
  api<CourseTree>(`/api/lessons/${lessonId}/topics`, { method: 'POST', body: description ? { title, description } : { title } });

// A new topic with its cover picture. The topic is made first, so a cover that fails to upload leaves the topic in place: the
// answer is the tree as it now is, and the reason the cover is missing (null when all went well).
export async function addTopicWithCover(
  tree: CourseTree,
  lessonId: string,
  title: string,
  description: string,
  cover: File | null,
): Promise<{ tree: CourseTree; coverFailure: unknown }> {
  const known = new Set(tree.lessons.find((lesson) => lesson.id === lessonId)?.topics.map((topic) => topic.id));
  const added = await addTopic(lessonId, title, description);
  const created = added.lessons.find((lesson) => lesson.id === lessonId)?.topics.find((topic) => !known.has(topic.id));
  if (!cover || !created) return { tree: added, coverFailure: null };
  try {
    await uploadTopicCover(created.id, cover);
  } catch (coverFailure) {
    return { tree: added, coverFailure };
  }
  // The covers are links to the stored pictures, so the tree is read again to show the new one.
  return { tree: await getCourse(tree.id), coverFailure: null };
}

export const reorderTopics =(lessonId: string, ids: string[]): Promise<CourseTree> =>
  api<CourseTree>(`/api/lessons/${lessonId}/topics/order`, { method: 'PUT', body: { ids } });

export const updateTopic = (id: string, input: { title?: string; description?: string }): Promise<TopicView> =>
  api<TopicView>(`/api/topics/${id}`, { method: 'PATCH', body: input });


export const addLibraryAttachment = (topicId: string, itemId: string, description?: string): Promise<Attachment> =>
  api<Attachment>(`/api/topics/${topicId}/attachments/library`, { method: 'POST', body: description ? { itemId, description } : { itemId } });

export const updateAttachment = (id: string, input: { title?: string; description?: string }): Promise<Attachment> =>
  api<Attachment>(`/api/attachments/${id}`, { method: 'PATCH', body: input });

export const reorderAttachments = (topicId: string, ids: string[]): Promise<Attachment[]> =>
  api<Attachment[]>(`/api/topics/${topicId}/attachments/order`, { method: 'PUT', body: { ids } });

// A one-hour link to view or play the attachment; every link is recorded in the audit log.
export const openAttachment = (id: string): Promise<OpenLink> => api<OpenLink>(`/api/attachments/${id}/open`, { method: 'POST' });

// Admins only: each moves the item, with what is under it, to the Trash (see api/trash.ts).
export const deleteCourse = (id: string): Promise<void> => api<void>(`/api/courses/${id}`, { method: 'DELETE' });

export const deleteLesson = (id: string): Promise<CourseTree> => api<CourseTree>(`/api/lessons/${id}`, { method: 'DELETE' });

export const deleteTopic = (id: string): Promise<CourseTree> => api<CourseTree>(`/api/topics/${id}`, { method: 'DELETE' });

// The cover image of a lesson, a topic or an uploaded attachment: three steps (see uploadCoverTo), the answer is the owner as it is now.
export const uploadLessonCover = (id: string, file: File): Promise<CourseTree> => uploadCoverTo<CourseTree>(`/api/lessons/${id}`, file);

export const uploadTopicCover = (id: string, file: File): Promise<TopicView> => uploadCoverTo<TopicView>(`/api/topics/${id}`, file);

export const uploadAttachmentCover = (id: string, file: File): Promise<Attachment> => uploadCoverTo<Attachment>(`/api/attachments/${id}`, file);

// Admins only: the attachment goes to the Trash (see api/trash.ts). A library file only leaves the topic.
export const deleteAttachment = (id: string): Promise<void> => api<void>(`/api/attachments/${id}`, { method: 'DELETE' });
