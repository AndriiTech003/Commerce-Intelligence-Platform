import { Inject, Injectable } from '@nestjs/common';
import { hasPermission, permissionsFor, uuidRegex, type Permission } from '@cip/contracts';
import {
  ForbiddenError,
  RateLimitedError,
  UnauthorizedError,
  ValidationFailedError,
} from '../../../shared/errors';
import type { Actor } from '../../../shared/request-context';
import { AuthService, SessionService } from '../../identity';
import { TenantService, type Tenant } from '../../tenancy';
import { ApiKeyService } from './api-key.service';
import { STOREFRONT_RATE_LIMITER, type RateLimitResult, type StorefrontRateLimiter } from './ports';

export interface AdminAccess {
  tenantId: string;
  actor: Actor;
}

@Injectable()
export class AccessService {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ApiKeyService) private readonly apiKeys: ApiKeyService,
    @Inject(TenantService) private readonly tenants: TenantService,
    @Inject(STOREFRONT_RATE_LIMITER) private readonly limiter: StorefrontRateLimiter,
  ) {}

  async staff(bearer: string | null): Promise<Actor> {
    if (!bearer || bearer.startsWith('sk_') || bearer.startsWith('pk_')) throw new UnauthorizedError();
    const claims = await this.sessions.verify(bearer);
    if (!claims || claims.typ !== 'staff') throw new UnauthorizedError('Invalid or expired access token');
    return { type: 'user', id: claims.sub, permissions: [], isPlatformAdmin: claims.pa === true };
  }

  async platform(bearer: string | null): Promise<Actor> {
    const actor = await this.staff(bearer);
    const user = await this.auth.userById(actor.id!);
    if (!user?.isPlatformAdmin) throw new ForbiddenError('Platform admin only');
    return { ...actor, isPlatformAdmin: true };
  }

  async admin(
    bearer: string | null,
    tenantHeader: string | null,
    permission?: Permission,
  ): Promise<AdminAccess> {
    if (tenantHeader && !uuidRegex.test(tenantHeader))
      throw new ValidationFailedError('X-Tenant-Id must be a UUID');
    let access: AdminAccess;
    if (bearer?.startsWith('sk_')) {
      const key = await this.apiKeys.authenticate(bearer, 'secret');
      if (!key) throw new UnauthorizedError('Invalid API key');
      if (tenantHeader && tenantHeader !== key.tenantId)
        throw new ForbiddenError('API key does not belong to this store');
      access = { tenantId: key.tenantId, actor: { type: 'api_key', id: key.id, permissions: key.scopes } };
    } else {
      const actor = await this.staff(bearer);
      if (!tenantHeader) throw new ValidationFailedError('X-Tenant-Id header is required');
      const role = await this.auth.roleIn(tenantHeader, actor.id!);
      if (!role) throw new ForbiddenError('You are not a member of this store');
      access = { tenantId: tenantHeader, actor: { ...actor, role, permissions: permissionsFor(role) } };
    }
    if (permission && !hasPermission(access.actor.permissions, permission)) {
      throw new ForbiddenError(`Missing permission ${permission}`);
    }
    return access;
  }

  async store(slug: string | null): Promise<Tenant> {
    if (!slug) throw new ValidationFailedError('Store is not specified (X-Store header or store subdomain)');
    return this.tenants.resolveStore(slug);
  }

  async customer(bearer: string | null, tenantId: string): Promise<Actor | null> {
    if (!bearer) return null;
    const claims = await this.sessions.verify(bearer);
    if (!claims || claims.typ !== 'customer' || claims.tid !== tenantId) {
      throw new UnauthorizedError('Invalid or expired customer token');
    }
    return { type: 'customer', id: claims.sub, permissions: [] };
  }

  rateLimit(subject: string): Promise<RateLimitResult> {
    return this.limiter.hit(subject);
  }

  rejectRateLimited(result: RateLimitResult): never {
    throw new RateLimitedError(result.resetSeconds);
  }
}
