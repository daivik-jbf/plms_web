import { api } from './client';
import type { User } from './auth';

export type Role = User['role'];

export interface Person {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: 'active' | 'deactivated';
  createdAt: string;
}

export interface Invite {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: 'pending' | 'expired' | 'accepted' | 'cancelled';
  expiresAt: string;
  createdAt: string;
  invitedBy: string | null;
}

export const listPeople = (): Promise<Person[]> => api<Person[]>('/api/users');

export const changeRole = (id: string, role: Role): Promise<Person> =>
  api<Person>(`/api/users/${id}/role`, { method: 'PATCH', body: { role } });

export const deactivatePerson = (id: string): Promise<Person> => api<Person>(`/api/users/${id}/deactivate`, { method: 'POST' });

export const reactivatePerson = (id: string): Promise<Person> => api<Person>(`/api/users/${id}/reactivate`, { method: 'POST' });

export const listInvites = (): Promise<Invite[]> => api<Invite[]>('/api/invites');

export const createInvite = (input: { name: string; email: string; role: Role }): Promise<Invite> =>
  api<Invite>('/api/invites', { method: 'POST', body: input });

export const resendInvite = (id: string): Promise<Invite> => api<Invite>(`/api/invites/${id}/resend`, { method: 'POST' });

export const cancelInvite = (id: string): Promise<void> => api<void>(`/api/invites/${id}`, { method: 'DELETE' });
