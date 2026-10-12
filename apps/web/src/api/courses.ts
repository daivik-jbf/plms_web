import { api } from './client';

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

export const listCourses = (): Promise<CourseSummary[]> => api<CourseSummary[]>('/api/courses');

export const createCourse = (input: { title: string; description: string }): Promise<CourseSummary> =>
  api<CourseSummary>('/api/courses', { method: 'POST', body: input });

export const reorderCourses = (ids: string[]): Promise<CourseSummary[]> =>
  api<CourseSummary[]>('/api/courses/order', { method: 'PUT', body: { ids } });

export const updateCourse = (id: string, input: { title?: string; description?: string }): Promise<CourseTree> =>
  api<CourseTree>(`/api/courses/${id}`, { method: 'PATCH', body: input });
