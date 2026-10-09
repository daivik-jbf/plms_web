import type { AuthUser } from '../auth/auth.types';

export const actorOf = (actor: AuthUser) => ({ id: actor.id, role: actor.role, label: actor.email });
