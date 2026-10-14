import { Module } from '@nestjs/common';
import { AuditAnalyticsService } from './audit-analytics.service';
import { AuditExportService } from './audit-export.service';
import { AuditController } from './audit.controller';
import { AuditQueryService } from './audit-query.service';
import { AuditService } from './audit.service';

@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditQueryService, AuditExportService, AuditAnalyticsService],
  exports: [AuditService],
})
export class AuditModule {}
