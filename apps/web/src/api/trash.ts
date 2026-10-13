import { api } from './client';

export type TrashType = 'course' | 'lesson' | 'topic' | 'attachment';

export interface TrashEntry {
  type: TrashType;
  id: string;
  title: string;
  deletedAt: string;
  deletedBy: { id: string; name: string } | null;
  // Where it was: a lesson names its course, a topic its lesson and course.
  courseTitle: string | null;
  lessonTitle: string | null;
  topicTitle?: string | null;
  // What goes with it: a course its lessons and topics, a lesson its topics.
  lessonCount: number | null;
  topicCount: number | null;
}

// Admins only.
export const listTrash = (): Promise<TrashEntry[]> => api<TrashEntry[]>('/api/trash');

export const restoreFromTrash = (type: TrashType, id: string): Promise<void> => api<void>(`/api/trash/${type}/${id}/restore`, { method: 'POST' });

// Removes the item and everything under it, files included, for good.
export const deleteForGood = (type: TrashType, id: string): Promise<void> => api<void>(`/api/trash/${type}/${id}`, { method: 'DELETE' });
