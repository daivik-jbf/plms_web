import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodPipe } from '../common/zod.pipe';
import type { ItemView } from './items.service';
import { completeUploadSchema, partUrlsSchema, startUploadSchema } from './media.schemas';
import { UploadsService } from './uploads.service';

// A 2 GiB upload is about 128 pieces plus retries, so these routes are throttled far more generously than the default.
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@Controller('media/uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  start(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(startUploadSchema)) body: z.infer<typeof startUploadSchema>) {
    return this.uploads.start(actor, body);
  }

  // Declared before ":fileId" so "mine" is not read as an id.
  @Get('mine')
  mine(@CurrentUser() actor: AuthUser) {
    return this.uploads.mine(actor);
  }

  @Post(':fileId/part-urls')
  @HttpCode(200)
  partUrls(
    @CurrentUser() actor: AuthUser,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body(new ZodPipe(partUrlsSchema)) body: z.infer<typeof partUrlsSchema>,
  ) {
    return this.uploads.partUrls(actor, fileId, body.partNumbers);
  }

  @Get(':fileId')
  status(@CurrentUser() actor: AuthUser, @Param('fileId', ParseUUIDPipe) fileId: string) {
    return this.uploads.status(actor, fileId);
  }

  @Post(':fileId/complete')
  @HttpCode(200)
  complete(
    @CurrentUser() actor: AuthUser,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body(new ZodPipe(completeUploadSchema)) body: z.infer<typeof completeUploadSchema>,
  ): Promise<ItemView> {
    return this.uploads.complete(actor, fileId, body.parts);
  }

  @Delete(':fileId')
  @HttpCode(204)
  cancel(@CurrentUser() actor: AuthUser, @Param('fileId', ParseUUIDPipe) fileId: string): Promise<void> {
    return this.uploads.cancel(actor, fileId);
  }
}
