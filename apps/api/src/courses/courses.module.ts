import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MediaModule } from '../media/media.module';
import { AttachmentsController } from './attachments.controller';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';
import { LessonsController } from './lessons.controller';
import { LessonsService } from './lessons.service';
import { TopicsController } from './topics.controller';
import { TopicsService } from './topics.service';
import { TrashController } from './trash.controller';
import { TrashService } from './trash.service';

@Module({
  imports: [AuditModule, MediaModule],
  controllers: [CoursesController, LessonsController, TopicsController, AttachmentsController, TrashController],
  providers: [CoursesService, LessonsService, TopicsService, TrashService],
  exports: [CoursesService, LessonsService, TopicsService],
})
export class CoursesModule {}
