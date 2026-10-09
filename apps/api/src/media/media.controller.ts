import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodPipe } from '../common/zod.pipe';
import { type FolderView, FoldersService } from './folders.service';
import { folderBodySchema, orderSchema } from './media.schemas';

// Every route needs a signed-in person (Admin or Staff); there is no @Roles because both may do everything here.
@Controller('media')
export class MediaController {
  constructor(private readonly folders: FoldersService) {}

  @Get('videos/folders')
  listFolders(): Promise<FolderView[]> {
    return this.folders.list();
  }

  @Post('videos/folders')
  createFolder(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(folderBodySchema)) body: z.infer<typeof folderBodySchema>): Promise<FolderView> {
    return this.folders.create(actor, body.name);
  }

  @Put('videos/folders/order')
  reorderFolders(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(orderSchema)) body: z.infer<typeof orderSchema>): Promise<FolderView[]> {
    return this.folders.reorder(actor, body.ids);
  }

  @Patch('folders/:id')
  renameFolder(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(folderBodySchema)) body: z.infer<typeof folderBodySchema>,
  ): Promise<FolderView> {
    return this.folders.rename(actor, id, body.name);
  }
}
