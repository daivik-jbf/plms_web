import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { FoldersService } from './folders.service';
import { ItemsService } from './items.service';
import { MediaController } from './media.controller';

@Module({
  imports: [AuditModule],
  controllers: [MediaController],
  providers: [FoldersService, ItemsService],
  exports: [ItemsService],
})
export class MediaModule {}
