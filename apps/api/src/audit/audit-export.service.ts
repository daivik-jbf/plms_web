import { Inject, Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DB, type Database } from '../db/db.module';
import { type AuditEntryView, AuditQueryService } from './audit-query.service';
import { csvRow } from './csv';
import type { AuditFilters } from './audit.schemas';
import { AuditService } from './audit.service';

const COLUMNS = [
  'Time (UTC)', 'Person', 'Role', 'Action', 'Label', 'Target type', 'Target', 'Source', 'IP', 'App version', 'Request id', 'Summary', 'Changes',
];
const CHUNK = 1000;
// Lets Excel detect UTF-8.
const BOM = '﻿';

const toRow = (view: AuditEntryView): unknown[] => [
  view.occurredAt.toISOString(),
  view.actor?.name ?? view.actor?.label,
  view.actor?.role,
  view.action,
  view.label,
  view.target?.type,
  view.target?.name ?? view.target?.label,
  view.source,
  view.ip,
  view.appVersion,
  view.requestId,
  view.summary,
  view.changes,
];

@Injectable()
export class AuditExportService {
  private readonly logger = new Logger(AuditExportService.name);

  constructor(
    private readonly queries: AuditQueryService,
    private readonly audit: AuditService,
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async writeCsv(admin: AuthUser, filters: AuditFilters, res: Response): Promise<void> {
    const max = this.env.AUDIT_EXPORT_MAX_ROWS;
    const total = await this.queries.count(filters);
    if (total > max) {
      throw new PayloadTooLargeException(`Too many rows to export (limit ${max}). Narrow the filters.`);
    }
    await this.audit.record(this.db, {
      actor: { id: admin.id, role: admin.role, label: admin.email },
      action: 'audit.exported',
      metadata: { filters, rowCount: total },
    });

    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.write(`${BOM}${csvRow([...COLUMNS])}`);
    try {
      for await (const page of this.queries.pages(filters, CHUNK)) {
        res.write(page.map((view) => csvRow(toRow(view))).join(''));
      }
      res.end();
    } catch (error) {
      this.logger.error(`Audit export failed part-way: ${error instanceof Error ? error.message : String(error)}`);
      res.destroy(error instanceof Error ? error : undefined);
    }
  }
}
