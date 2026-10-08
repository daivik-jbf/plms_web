import { Controller, Get, HttpCode, Inject, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { ZodPipe } from '../common/zod.pipe';
import { DB, type Database } from '../db/db.module';
import { AuditExportService } from './audit-export.service';
import { type AuditEntryView, AuditQueryService } from './audit-query.service';
import { type AuditFilters, type AuditQuery, auditFilterSchema, auditQuerySchema } from './audit.schemas';
import { AuditService } from './audit.service';

@Roles('admin')
@Controller('audit')
export class AuditController {
  constructor(
    private readonly queries: AuditQueryService,
    private readonly exporter: AuditExportService,
    private readonly audit: AuditService,
    @Inject(DB) private readonly db: Database,
  ) {}

  @Get()
  list(@Query(new ZodPipe(auditQuerySchema)) query: AuditQuery): Promise<{ items: AuditEntryView[]; nextCursor: string | null }> {
    return this.queries.list(query);
  }

  // The Audit page calls this once when it opens; filter and page changes do not.
  @Post('opened')
  @HttpCode(204)
  async opened(@CurrentUser() user: AuthUser): Promise<void> {
    await this.audit.record(this.db, {
      actor: { id: user.id, role: user.role, label: user.email },
      action: 'audit.viewed',
    });
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('export.csv')
  async exportCsv(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(auditFilterSchema)) filters: AuditFilters,
    @Res() res: Response,
  ): Promise<void> {
    await this.exporter.writeCsv(user, filters, res);
  }
}
