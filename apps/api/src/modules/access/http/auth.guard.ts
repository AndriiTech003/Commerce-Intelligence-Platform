import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../../shared/errors';
import { SURFACE_KEY, type SurfaceMeta } from '../../../shared/http/surface';
import { currentContext } from '../../../shared/request-context';
import { storeSlugFromHost } from '../../tenancy';
import { AccessService } from '../application/access.service';

function header(req: Request, name: string): string | null {
  const value = req.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.length > 0 ? first : null;
}

function bearer(req: Request): string | null {
  const auth = header(req, 'authorization');
  if (!auth) return null;
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match ? match[1]!.trim() : null;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AccessService) private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const meta = this.reflector.getAllAndOverride<SurfaceMeta | undefined>(SURFACE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? { kind: 'staff' };
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const ctx = currentContext();
    if (!ctx) return false;
    switch (meta.kind) {
      case 'public':
        return true;
      case 'staff':
        ctx.actor = await this.access.staff(bearer(req));
        return true;
      case 'platform':
        ctx.actor = await this.access.platform(bearer(req));
        return true;
      case 'admin': {
        const result = await this.access.admin(bearer(req), header(req, 'x-tenant-id'), meta.permission);
        ctx.tenantId = result.tenantId;
        ctx.actor = result.actor;
        return true;
      }
      case 'storefront': {
        const slug =
          header(req, 'x-store') ?? storeSlugFromHost(header(req, 'x-forwarded-host') ?? header(req, 'host'));
        const limit = await this.access.rateLimit(`${ctx.ip ?? 'unknown'}`);
        res.setHeader('RateLimit-Limit', String(limit.limit));
        res.setHeader('RateLimit-Remaining', String(limit.remaining));
        res.setHeader('RateLimit-Reset', String(limit.resetSeconds));
        if (!limit.allowed) this.access.rejectRateLimited(limit);
        const tenant = await this.access.store(slug);
        ctx.tenantId = tenant.id;
        ctx.tenantSlug = tenant.slug;
        const customer = await this.access.customer(bearer(req), tenant.id);
        ctx.actor = customer ?? { type: 'anonymous', id: null, permissions: [] };
        if (meta.customer === 'required' && !customer) throw new UnauthorizedError('Customer login required');
        return true;
      }
    }
  }
}
