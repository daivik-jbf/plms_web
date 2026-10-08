import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { ZodPipe } from '../common/zod.pipe';
import { type UserView, UsersService } from './users.service';

const roleSchema = z.object({ role: z.enum(['admin', 'staff']) });

@Roles('admin')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(): Promise<UserView[]> {
    return this.users.list();
  }

  @Patch(':id/role')
  changeRole(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(roleSchema)) body: z.infer<typeof roleSchema>,
  ): Promise<UserView> {
    return this.users.changeRole(actor, id, body.role);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<UserView> {
    return this.users.deactivate(actor, id);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<UserView> {
    return this.users.reactivate(actor, id);
  }
}
