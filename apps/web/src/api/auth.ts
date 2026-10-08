import { api, refreshSession, setAccessToken } from './client';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'staff';
}

export async function login(email: string, password: string): Promise<User> {
  const result = await api<{ accessToken: string; user: User }>('/api/auth/login', {
    method: 'POST',
    body: { email, password, client: 'web' },
    auth: false,
  });
  setAccessToken(result.accessToken);
  return result.user;
}

const fetchMe = (): Promise<User> => api<User>('/api/auth/me');

export async function restoreSession(): Promise<User | null> {
  if (!(await refreshSession())) return null;
  return fetchMe();
}

export async function logout(): Promise<void> {
  try {
    await api('/api/auth/logout', { method: 'POST', body: { client: 'web' }, auth: false });
  } finally {
    setAccessToken(null);
  }
}

export const previewInvite = (token: string): Promise<{ name: string; email: string }> =>
  api('/api/invites/preview', { method: 'POST', body: { token }, auth: false });

export const acceptInvite = (token: string, password: string): Promise<void> =>
  api('/api/invites/accept', { method: 'POST', body: { token, password }, auth: false });

export const forgotPassword = (email: string): Promise<void> =>
  api('/api/auth/forgot-password', { method: 'POST', body: { email }, auth: false });

export const resetPassword = (token: string, newPassword: string): Promise<void> =>
  api('/api/auth/reset-password', { method: 'POST', body: { token, newPassword }, auth: false });

export const fetchPasswordPolicy = (): Promise<{ minLength: number; maxLength: number }> =>
  api('/api/auth/password-policy', { auth: false });
