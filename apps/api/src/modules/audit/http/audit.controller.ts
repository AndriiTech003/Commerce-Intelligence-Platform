import { Controller, Get, Inject } from '@nestjs/common';
import { auditEntrySchema, auditQuerySchema, pageSchema } from '@cip/contracts';
import type { z } from 'zod';
import { Doc } from '../../../shared/http/doc';
import { Admin } from '../../../shared/http/surface';
import { ZQuery } from '../../../shared/http/zod';
import { AuditService } from '../application/audit.service';

@Controller('v1/admin/audit-log')
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  @Admin('settings:write')
  @Doc({
    summary: 'Audit log of admin changes with diffs',
    tags: ['audit'],
    query: auditQuerySchema,
    response: pageSchema(auditEntrySchema),
  })
  list(@ZQuery(auditQuerySchema) query: z.infer<typeof auditQuerySchema>) {
    return this.audit.list(query);
  }
}
