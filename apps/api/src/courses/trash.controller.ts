import { Controller, Delete, Get, HttpCode, Param, ParseEnumPipe, ParseUUIDPipe, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { TRASH_TYPES, type TrashEntry, type TrashType, TrashService } from './trash.service';

const TYPES = Object.fromEntries(TRASH_TYPES.map((type) => [type, type]));

// Only Admins see the Trash, restore from it and delete from it for good.
@Controller('trash')
@Roles('admin')
export class TrashController {
  constructor(private readonly trash: TrashService) {}

  @Get()
  list(): Promise<TrashEntry[]> {
    return this.trash.list();
  }

  @Post(':type/:id/restore')
  @HttpCode(204)
  restore(
    @CurrentUser() actor: AuthUser,
    @Param('type', new ParseEnumPipe(TYPES)) type: TrashType,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.trash.restore(actor, type, id);
  }

  @Delete(':type/:id')
  @HttpCode(204)
  purge(
    @CurrentUser() actor: AuthUser,
    @Param('type', new ParseEnumPipe(TYPES)) type: TrashType,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.trash.purge(actor, type, id);
  }
}
