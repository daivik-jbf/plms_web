import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { ZodPipe } from '../common/zod.pipe';
import { type AuditEntryView, AuditQueryService } from './audit-query.service';
import { type AuditQuery, auditQuerySchema } from './audit.schemas';

@Roles('admin')
@Controller('audit')
export class AuditController {
  constructor(private readonly queries: AuditQueryService) {}

  @Get()
  list(@Query(new ZodPipe(auditQuerySchema)) query: AuditQuery): Promise<{ items: AuditEntryView[]; nextCursor: string | null }> {
    return this.queries.list(query);
  }
}
