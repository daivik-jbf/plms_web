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
  // Ready attachments only.
  attachmentCount: number;
}

export interface LessonNode {
  id: string;
  title: string;
  position: number;
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
}

export type AttachmentKind = 'video' | 'audio' | 'pdf' | 'image';

export interface Attachment {
  id: string;
  topicId: string;
  position: number;
  kind: AttachmentKind;
  title: string;
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


export const addLesson = (courseId: string, title: string): Promise<CourseTree> =>
  api<CourseTree>(`/api/courses/${courseId}/lessons`, { method: 'POST', body: { title } });

export const renameLesson = (id: string, title: string): Promise<CourseTree> => api<CourseTree>(`/api/lessons/${id}`, { method: 'PATCH', body: { title } });

export const reorderLessons = (courseId: string, ids: string[]): Promise<CourseTree> =>
  api<CourseTree>(`/api/courses/${courseId}/lessons/order`, { method: 'PUT', body: { ids } });

export const addTopic = (lessonId: string, title: string): Promise<CourseTree> =>
  api<CourseTree>(`/api/lessons/${lessonId}/topics`, { method: 'POST', body: { title } });

export const reorderTopics = (lessonId: string, ids: string[]): Promise<CourseTree> =>
  api<CourseTree>(`/api/lessons/${lessonId}/topics/order`, { method: 'PUT', body: { ids } });

export const updateTopic = (id: string, input: { title?: string; description?: string }): Promise<TopicView> =>
  api<TopicView>(`/api/topics/${id}`, { method: 'PATCH', body: input });


export const addLibraryAttachment = (topicId: string, itemId: string): Promise<Attachment> =>
  api<Attachment>(`/api/topics/${topicId}/attachments/library`, { method: 'POST', body: { itemId } });

export const renameAttachment = (id: string, title: string): Promise<Attachment> =>
  api<Attachment>(`/api/attachments/${id}`, { method: 'PATCH', body: { title } });

export const reorderAttachments = (topicId: string, ids: string[]): Promise<Attachment[]> =>
  api<Attachment[]>(`/api/topics/${topicId}/attachments/order`, { method: 'PUT', body: { ids } });

// A one-hour link to view or play the attachment; every link is recorded in the audit log.
export const openAttachment = (id: string): Promise<OpenLink> => api<OpenLink>(`/api/attachments/${id}/open`, { method: 'POST' });
