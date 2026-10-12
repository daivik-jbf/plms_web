import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodPipe } from '../common/zod.pipe';
import { type CoverStartInput, coverStartSchema, orderSchema } from '../media/media.schemas';
import {
  type CreateCourseInput,
  createCourseSchema,
  type LessonInput,
  lessonBodySchema,
  type UpdateCourseInput,
  updateCourseSchema,
} from './courses.schemas';
import { type CourseTree, CoursesService, type CourseView } from './courses.service';
import { LessonsService } from './lessons.service';

// Every route needs a signed-in person (Admin or Staff); there is no @Roles because both may do everything here.
@Controller('courses')
export class CoursesController {
  constructor(
    private readonly courses: CoursesService,
    private readonly lessons: LessonsService,
  ) {}

  @Get()
  list(): Promise<CourseView[]> {
    return this.courses.list();
  }

  @Post()
  create(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(createCourseSchema)) body: CreateCourseInput): Promise<CourseView> {
    return this.courses.create(actor, body);
  }

  @Put('order')
  reorder(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(orderSchema)) body: z.infer<typeof orderSchema>): Promise<CourseView[]> {
    return this.courses.reorder(actor, body.ids);
  }

  @Get(':id')
  tree(@Param('id', ParseUUIDPipe) id: string): Promise<CourseTree> {
    return this.courses.tree(id);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateCourseSchema)) body: UpdateCourseInput,
  ): Promise<CourseTree> {
    return this.courses.update(actor, id, body);
  }

  @Post(':id/cover')
  startCover(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(coverStartSchema)) body: CoverStartInput,
  ) {
    return this.courses.startCover(actor, id, body);
  }

  @Post(':id/cover/:fileId/complete')
  @HttpCode(200)
  completeCover(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<CourseTree> {
    return this.courses.completeCover(actor, id, fileId);
  }

  @Post(':id/lessons')
  addLesson(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(lessonBodySchema)) body: LessonInput,
  ): Promise<CourseTree> {
    return this.lessons.add(actor, id, body);
  }

  @Put(':id/lessons/order')
  reorderLessons(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(orderSchema)) body: z.infer<typeof orderSchema>,
  ): Promise<CourseTree> {
    return this.lessons.reorder(actor, id, body.ids);
  }
}
