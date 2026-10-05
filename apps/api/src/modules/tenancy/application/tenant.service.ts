import { Inject, Injectable } from '@nestjs/common';
import { currentContext } from '../../../shared/request-context';
import { CONFIG } from '../../../shared/tokens';
import type { ApiConfig } from '../../../config';
import {
  normalizeSettings,
  NotFoundError,
  TenantNotFoundError,
  TenantSuspendedError,
  type Tenant,
} from '../domain/tenant';
import { TENANT_REPOSITORY, type TenantRepository } from './ports';

export interface TenantSettingsView {
  name: string;
  slug: string;
  currency: string;
  lowStockThreshold: number;
  brandColor: string;
  tagline: string;
  trackingKey: string | null;
  language: string;
  brandVoice: string;
  bannedClaims: string[];
  aiCreativesDailyLimit: number;
}

@Injectable()
export class TenantService {
  private readonly cache = new Map<string, { tenant: Tenant; expires: number }>();

  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  async resolveStore(slug: string): Promise<Tenant> {
    const hit = this.cache.get(slug);
    if (hit && hit.expires > Date.now()) return hit.tenant;
    const tenant = await this.tenants.findBySlug(slug);
    if (!tenant) throw new TenantNotFoundError(slug);
    if (tenant.status !== 'active') throw new TenantSuspendedError();
    this.cache.set(slug, { tenant, expires: Date.now() + 30000 });
    return tenant;
  }

  invalidate(slug: string): void {
    this.cache.delete(slug);
  }

  async byId(id: string): Promise<Tenant> {
    const tenant = await this.tenants.findById(id);
    if (!tenant) throw new NotFoundError('Tenant', id);
    return tenant;
  }

  async current(): Promise<Tenant> {
    const tenantId = currentContext()?.tenantId;
    if (!tenantId) throw new NotFoundError('Tenant');
    return this.byId(tenantId);
  }

  view(tenant: Tenant): TenantSettingsView {
    return { name: tenant.name, slug: tenant.slug, ...tenant.settings };
  }

  async updateSettings(patch: {
    name?: string | undefined;
    lowStockThreshold?: number | undefined;
    brandColor?: string | undefined;
    tagline?: string | undefined;
    language?: string | undefined;
    brandVoice?: string | undefined;
    bannedClaims?: string[] | undefined;
    aiCreativesDailyLimit?: number | undefined;
  }): Promise<{ before: TenantSettingsView; after: TenantSettingsView }> {
    const tenant = await this.current();
    const settings = normalizeSettings({
      ...tenant.settings,
      ...(patch.lowStockThreshold !== undefined ? { lowStockThreshold: patch.lowStockThreshold } : {}),
      ...(patch.brandColor !== undefined ? { brandColor: patch.brandColor } : {}),
      ...(patch.tagline !== undefined ? { tagline: patch.tagline } : {}),
      ...(patch.language !== undefined ? { language: patch.language } : {}),
      ...(patch.brandVoice !== undefined ? { brandVoice: patch.brandVoice } : {}),
      ...(patch.bannedClaims !== undefined ? { bannedClaims: patch.bannedClaims } : {}),
      ...(patch.aiCreativesDailyLimit !== undefined
        ? { aiCreativesDailyLimit: patch.aiCreativesDailyLimit }
        : {}),
    });
    const updated = await this.tenants.update(tenant.id, {
      ...(patch.name ? { name: patch.name } : {}),
      settings,
    });
    this.invalidate(tenant.slug);
    return { before: this.view(tenant), after: this.view(updated) };
  }

  storeInfo(tenant: Tenant) {
    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      currency: tenant.settings.currency,
      brandColor: tenant.settings.brandColor,
      tagline: tenant.settings.tagline,
      trackingKey: tenant.settings.trackingKey,
      collectorUrl: this.config.COLLECTOR_PUBLIC_URL,
      paymentProvider: this.config.PAYMENT_PROVIDER,
    };
  }

  listAll() {
    return this.tenants.listAll();
  }
}
