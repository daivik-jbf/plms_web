import { ApiError, api } from './client';

export type MediaCategory = 'video' | 'movie' | 'podcast' | 'song';
export type CategorySlug = 'videos' | 'movies' | 'podcasts' | 'songs';

export interface Folder {
  id: string;
  name: string;
  position: number;
  itemCount: number;
  category: MediaCategory;
}

export interface MediaItem {
  id: string;
  folderId: string;
  title: string;
  description: string | null;
  durationSeconds: number | null;
  sizeBytes: number;
  status: 'uploading' | 'ready';
  coverUrl: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
  position: number;
  category: MediaCategory;
}

export interface StartedUpload {
  itemId: string;
  fileId: string;
  partSize: number;
  partCount: number;
}

export interface UploadPart {
  partNumber: number;
  size: number;
  etag: string;
}

export interface UploadStatus {
  fileId: string;
  itemId: string;
  status: 'pending' | 'ready';
  partSize: number;
  partCount: number;
  uploadedParts: UploadPart[];
}

export interface PendingUpload {
  fileId: string;
  itemId: string;
  folderId: string;
  title: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

export interface PlayLink {
  url: string;
  expiresAt: string;
  contentType: string;
}

export interface StartUploadInput {
  folderId: string;
  title: string;
  description: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  durationSeconds: number | null;
}

export const listFolders = (slug: CategorySlug): Promise<Folder[]> => api<Folder[]>(`/api/media/${slug}/folders`);

export const createFolder = (slug: CategorySlug, name: string): Promise<Folder> =>
  api<Folder>(`/api/media/${slug}/folders`, { method: 'POST', body: { name } });

export const renameFolder = (id: string, name: string): Promise<Folder> =>
  api<Folder>(`/api/media/folders/${id}`, { method: 'PATCH', body: { name } });

export const reorderFolders = (slug: CategorySlug, ids: string[]): Promise<Folder[]> =>
  api<Folder[]>(`/api/media/${slug}/folders/order`, { method: 'PUT', body: { ids } });

export const listItems = (folderId: string): Promise<MediaItem[]> => api<MediaItem[]>(`/api/media/folders/${folderId}/items`);

export const updateItem = (id: string, input: { title?: string; description?: string }): Promise<MediaItem> =>
  api<MediaItem>(`/api/media/items/${id}`, { method: 'PATCH', body: input });

export const reorderItems = (folderId: string, ids: string[]): Promise<MediaItem[]> =>
  api<MediaItem[]>(`/api/media/folders/${folderId}/items/order`, { method: 'PUT', body: { ids } });

export const playItem = (id: string): Promise<PlayLink> => api<PlayLink>(`/api/media/items/${id}/play`, { method: 'POST' });

export const startUpload = (input: StartUploadInput): Promise<StartedUpload> =>
  api<StartedUpload>('/api/media/uploads', { method: 'POST', body: input });

export const getPartUrls = (fileId: string, partNumbers: number[]): Promise<{ urls: Record<string, string> }> =>
  api(`/api/media/uploads/${fileId}/part-urls`, { method: 'POST', body: { partNumbers } });

export const getUploadStatus = (fileId: string): Promise<UploadStatus> => api<UploadStatus>(`/api/media/uploads/${fileId}`);

export const completeUpload = (fileId: string, parts: { partNumber: number; etag: string }[]): Promise<MediaItem> =>
  api<MediaItem>(`/api/media/uploads/${fileId}/complete`, { method: 'POST', body: { parts } });

export const cancelUpload = (fileId: string): Promise<void> => api<void>(`/api/media/uploads/${fileId}`, { method: 'DELETE' });

export const listMyUploads = (): Promise<PendingUpload[]> => api<PendingUpload[]>('/api/media/uploads/mine');

// Three steps: ask for a one-time link, send the file straight to storage (no sign-in header: the link is the
// credential), then tell the API to check and attach it.
export async function uploadCover(itemId: string, file: File): Promise<MediaItem> {
  const started = await api<{ fileId: string; url: string; headers: Record<string, string> }>(`/api/media/items/${itemId}/cover`, {
    method: 'POST',
    body: { contentType: file.type, sizeBytes: file.size },
  });
  const response = await fetch(started.url, { method: 'PUT', headers: started.headers, body: file });
  if (!response.ok) throw new ApiError(response.status, 'The cover image could not be uploaded. Please try again.');
  return api<MediaItem>(`/api/media/items/${itemId}/cover/${started.fileId}/complete`, { method: 'POST' });
}
