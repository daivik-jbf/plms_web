import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { ZodPipe } from '../common/zod.pipe';
import { type AttachmentView, AttachmentsService, type OpenLink } from '../media/attachments.service';
import { type CoverStartInput, coverStartSchema, type UpdateAttachmentInput, updateAttachmentSchema } from '../media/media.schemas';

@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Patch(':id')
  edit(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateAttachmentSchema)) body: UpdateAttachmentInput,
  ): Promise<AttachmentView> {
    return this.attachments.edit(actor, id, body);
  }

  // Admins only: the attachment goes to the Trash, where an Admin can restore it.
  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  remove(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.attachments.remove(actor, id);
  }

  @Post(':id/cover')
  startCover(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(coverStartSchema)) body: CoverStartInput,
  ) {
    return this.attachments.startCover(actor, id, body);
  }

  @Post(':id/cover/:fileId/complete')
  @HttpCode(200)
  completeCover(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<AttachmentView> {
    return this.attachments.completeCover(actor, id, fileId);
  }

  @Post(':id/open')
  @HttpCode(200)
  open(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<OpenLink> {
    return this.attachments.open(actor, id);
  }
}
