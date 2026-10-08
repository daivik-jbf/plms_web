import type { Role } from '../db/schema';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export type ClientKind = 'web' | 'mobile';
