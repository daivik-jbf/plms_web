import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CoversService } from './covers.service';
import { FoldersService } from './folders.service';
import { ItemsService } from './items.service';
import { MediaController } from './media.controller';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  imports: [AuditModule],
  controllers: [MediaController, UploadsController],
  providers: [CoversService, FoldersService, ItemsService, UploadsService],
  exports: [ItemsService],
})
export class MediaModule {}
