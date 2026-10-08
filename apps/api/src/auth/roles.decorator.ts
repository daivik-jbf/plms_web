import { SetMetadata } from '@nestjs/common';
import type { Role } from '../db/schema';

export const ROLES = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);
