import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { ZodPipe } from '../common/zod.pipe';
import {
  type AcceptInviteInput,
  acceptInviteSchema,
  type CreateInviteInput,
  createInviteSchema,
  tokenSchema,
} from './invites.schemas';
import { type InviteView, InvitesService } from './invites.service';

const publicThrottle = { default: { limit: 10, ttl: 60_000 } };

@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Roles('admin')
  @Post()
  async create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodPipe(createInviteSchema)) body: CreateInviteInput,
  ): Promise<InviteView> {
    return (await this.invites.create(actor, body, { sendEmail: true })).invite;
  }

  @Roles('admin')
  @Get()
  list(): Promise<InviteView[]> {
    return this.invites.list();
  }

  @Roles('admin')
  @Post(':id/resend')
  @HttpCode(200)
  async resend(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<InviteView> {
    return (await this.invites.resend(actor, id, { sendEmail: true })).invite;
  }

  @Roles('admin')
  @Delete(':id')
  @HttpCode(204)
  async cancel(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.invites.cancel(actor, id);
  }

  @Public()
  @Throttle(publicThrottle)
  @Post('preview')
  @HttpCode(200)
  preview(@Body(new ZodPipe(tokenSchema)) body: { token: string }): Promise<{ name: string; email: string }> {
    return this.invites.preview(body.token);
  }

  @Public()
  @Throttle(publicThrottle)
  @Post('accept')
  async accept(@Body(new ZodPipe(acceptInviteSchema)) body: AcceptInviteInput): Promise<AuthUser> {
    return this.invites.accept(body.token, body.password);
  }
}
