import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Logger } from '@cip/observability';
import type { Request } from 'express';
import { from, mergeMap, type Observable } from 'rxjs';
import { AUDIT_KEY, type AuditMeta } from '../../../shared/http/surface';
import { currentContext } from '../../../shared/request-context';
import { LOGGER } from '../../../shared/tokens';
import { AuditService } from '../application/audit.service';
import { entityIdFrom } from '../domain/audit';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMeta | undefined>(AUDIT_KEY, context.getHandler());
    if (!meta) return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      mergeMap((result: unknown) =>
        from(
          (async () => {
            const ctx = currentContext();
            if (ctx) {
              const entityId = entityIdFrom(req.params as Record<string, string>, result);
              await this.audit
                .write(ctx, { action: meta.action, entityType: meta.entityType, entityId }, ctx.audit)
                .catch((error: unknown) => this.logger.error({ err: error }, 'audit write failed'));
              ctx.audit = [];
            }
            return result;
          })(),
        ),
      ),
    );
  }
}
