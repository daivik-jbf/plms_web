import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { FoldersService } from './folders.service';
import { MediaController } from './media.controller';

@Module({
  imports: [AuditModule],
  controllers: [MediaController],
  providers: [FoldersService],
})
export class MediaModule {}
