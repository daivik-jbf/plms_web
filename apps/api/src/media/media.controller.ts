import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodPipe } from '../common/zod.pipe';
import { CoversService } from './covers.service';
import { type FolderView, FoldersService } from './folders.service';
import { type ItemView, ItemsService } from './items.service';
import { type CoverStartInput, coverStartSchema, folderBodySchema, orderSchema, type UpdateItemInput, updateItemSchema } from './media.schemas';

// Every route needs a signed-in person (Admin or Staff); there is no @Roles because both may do everything here.
@Controller('media')
export class MediaController {
  constructor(
    private readonly folders: FoldersService,
    private readonly items: ItemsService,
    private readonly covers: CoversService,
  ) {}

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

  @Get('folders/:id/items')
  listItems(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ItemView[]> {
    return this.items.list(actor, id);
  }

  @Put('folders/:id/items/order')
  reorderItems(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(orderSchema)) body: z.infer<typeof orderSchema>,
  ): Promise<ItemView[]> {
    return this.items.reorder(actor, id, body.ids);
  }

  @Patch('items/:id')
  updateItem(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateItemSchema)) body: UpdateItemInput,
  ): Promise<ItemView> {
    return this.items.update(actor, id, body);
  }

  @Post('items/:id/cover')
  startCover(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(coverStartSchema)) body: CoverStartInput,
  ) {
    return this.covers.start(actor, id, body);
  }

  @Post('items/:id/cover/:fileId/complete')
  @HttpCode(200)
  completeCover(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<ItemView> {
    return this.covers.complete(actor, id, fileId);
  }

  @Post('items/:id/play')
  @HttpCode(200)
  play(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.items.play(actor, id);
  }
}
