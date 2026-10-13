import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { ZodPipe } from '../common/zod.pipe';
import { type CoverStartInput, coverStartSchema, orderSchema } from '../media/media.schemas';
import { type CreateTopicInput, createTopicSchema, type LessonInput, lessonBodySchema } from './courses.schemas';
import type { CourseTree } from './courses.service';
import { LessonsService } from './lessons.service';
import { TopicsService } from './topics.service';

@Controller('lessons')
export class LessonsController {
  constructor(
    private readonly lessons: LessonsService,
    private readonly topics: TopicsService,
  ) {}

  @Patch(':id')
  rename(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(lessonBodySchema)) body: LessonInput,
  ): Promise<CourseTree> {
    return this.lessons.rename(actor, id, body);
  }

  // Admins only: the lesson, with its topics, goes to the Trash.
  @Delete(':id')
  @Roles('admin')
  remove(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<CourseTree> {
    return this.lessons.remove(actor, id);
  }

  @Post(':id/cover')
  startCover(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(coverStartSchema)) body: CoverStartInput,
  ) {
    return this.lessons.startCover(actor, id, body);
  }

  @Post(':id/cover/:fileId/complete')
  @HttpCode(200)
  completeCover(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<CourseTree> {
    return this.lessons.completeCover(actor, id, fileId);
  }

  @Post(':id/topics')
  addTopic(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(createTopicSchema)) body: CreateTopicInput,
  ): Promise<CourseTree> {
    return this.topics.add(actor, id, body);
  }

  @Put(':id/topics/order')
  reorderTopics(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(orderSchema)) body: z.infer<typeof orderSchema>,
  ): Promise<CourseTree> {
    return this.topics.reorder(actor, id, body.ids);
  }
}
