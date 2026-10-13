import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { ZodPipe } from '../common/zod.pipe';
import { type AttachmentView, AttachmentsService } from '../media/attachments.service';
import {
  type CoverStartInput,
  coverStartSchema,
  type LibraryAttachmentInput,
  libraryAttachmentSchema,
  orderSchema,
  type StartAttachmentUploadInput,
  startAttachmentUploadSchema,
} from '../media/media.schemas';
import { UploadsService } from '../media/uploads.service';
import { type UpdateTopicInput, updateTopicSchema } from './courses.schemas';
import type { CourseTree } from './courses.service';
import { type TopicDetail, TopicsService, type TopicView } from './topics.service';

@Controller('topics')
export class TopicsController {
  constructor(
    private readonly topics: TopicsService,
    private readonly attachments: AttachmentsService,
    private readonly uploads: UploadsService,
  ) {}

  @Get(':id')
  detail(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<TopicDetail> {
    return this.topics.detail(actor, id);
  }

  @Patch(':id')
  edit(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateTopicSchema)) body: UpdateTopicInput,
  ): Promise<TopicView> {
    return this.topics.edit(actor, id, body);
  }

  // Admins only: the topic, with its files, goes to the Trash.
  @Delete(':id')
  @Roles('admin')
  remove(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<CourseTree> {
    return this.topics.remove(actor, id);
  }

  @Post(':id/cover')
  startCover(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(coverStartSchema)) body: CoverStartInput,
  ) {
    return this.topics.startCover(actor, id, body);
  }

  @Post(':id/cover/:fileId/complete')
  @HttpCode(200)
  completeCover(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<TopicView> {
    return this.topics.completeCover(actor, id, fileId);
  }

  @Post(':id/attachments/library')
  attachFromLibrary(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(libraryAttachmentSchema)) body: LibraryAttachmentInput,
  ): Promise<AttachmentView> {
    return this.attachments.addFromLibrary(actor, id, body);
  }

  // Starts an upload into the topic; the pieces, status, completion, cancelling and listing then use /api/media/uploads/...
  @Post(':id/attachments/uploads')
  startUpload(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(startAttachmentUploadSchema)) body: StartAttachmentUploadInput,
  ) {
    return this.uploads.startAttachment(actor, id, body);
  }

  @Put(':id/attachments/order')
  reorderAttachments(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(orderSchema)) body: z.infer<typeof orderSchema>,
  ): Promise<AttachmentView[]> {
    return this.attachments.reorder(actor, id, body.ids);
  }
}
