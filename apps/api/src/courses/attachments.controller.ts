import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodPipe } from '../common/zod.pipe';
import { type AttachmentView, AttachmentsService, type OpenLink } from '../media/attachments.service';
import { attachmentTitleSchema } from '../media/media.schemas';

@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Patch(':id')
  rename(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(attachmentTitleSchema)) body: z.infer<typeof attachmentTitleSchema>,
  ): Promise<AttachmentView> {
    return this.attachments.rename(actor, id, body.title);
  }

  @Post(':id/open')
  @HttpCode(200)
  open(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<OpenLink> {
    return this.attachments.open(actor, id);
  }
}
