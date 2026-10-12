import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AttachmentsService } from './attachments.service';
import { CoversService } from './covers.service';
import { FoldersService } from './folders.service';
import { ItemsService } from './items.service';
import { MediaController } from './media.controller';
import { UploadCleanupService } from './upload-cleanup.service';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  imports: [AuditModule],
  controllers: [MediaController, UploadsController],
  providers: [AttachmentsService, CoversService, FoldersService, ItemsService, UploadCleanupService, UploadsService],
  exports: [AttachmentsService, CoversService, ItemsService, UploadsService],
})
export class MediaModule {}
