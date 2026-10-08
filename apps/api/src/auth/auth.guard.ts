import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { DB, type Database } from '../db/db.module';
import { users } from '../db/schema';
import type { AuthUser } from './auth.types';
import { IS_PUBLIC } from './public.decorator';
import { TokenService } from './token.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const userId = token ? await this.tokens.verifyAccess(token) : null;
    if (!userId) {
      throw new UnauthorizedException();
    }
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException();
    }
    request.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    return true;
  }
}
