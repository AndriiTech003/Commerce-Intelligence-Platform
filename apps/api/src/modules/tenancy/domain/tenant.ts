import { DomainError, NotFoundError } from '../../../shared/errors';

export interface TenantSettings {
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

export const DEFAULT_BANNED_CLAIMS = [
  'free shipping',
  'guaranteed',
  '#1',
  'number one',
  'best in the world',
  "world's best",
  'cheapest',
  'risk-free',
  'miracle',
  'lowest price ever',
];

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  settings: TenantSettings;
  createdAt: Date;
}

export const DEFAULT_SETTINGS: TenantSettings = {
  currency: 'USD',
  lowStockThreshold: 5,
  brandColor: '#2563eb',
  tagline: '',
  trackingKey: null,
  language: 'en',
  brandVoice: '',
  bannedClaims: DEFAULT_BANNED_CLAIMS,
  aiCreativesDailyLimit: 50,
};

export function normalizeSettings(raw: Record<string, unknown> | null | undefined): TenantSettings {
  const value = raw ?? {};
  return {
    currency: typeof value.currency === 'string' ? value.currency : DEFAULT_SETTINGS.currency,
    lowStockThreshold:
      typeof value.lowStockThreshold === 'number'
        ? value.lowStockThreshold
        : DEFAULT_SETTINGS.lowStockThreshold,
    brandColor: typeof value.brandColor === 'string' ? value.brandColor : DEFAULT_SETTINGS.brandColor,
    tagline: typeof value.tagline === 'string' ? value.tagline : DEFAULT_SETTINGS.tagline,
    trackingKey: typeof value.trackingKey === 'string' ? value.trackingKey : null,
    language: typeof value.language === 'string' ? value.language : DEFAULT_SETTINGS.language,
    brandVoice: typeof value.brandVoice === 'string' ? value.brandVoice : DEFAULT_SETTINGS.brandVoice,
    bannedClaims: Array.isArray(value.bannedClaims)
      ? value.bannedClaims.filter((c): c is string => typeof c === 'string')
      : DEFAULT_SETTINGS.bannedClaims,
    aiCreativesDailyLimit:
      typeof value.aiCreativesDailyLimit === 'number'
        ? value.aiCreativesDailyLimit
        : DEFAULT_SETTINGS.aiCreativesDailyLimit,
  };
}

export class TenantNotFoundError extends DomainError {
  constructor(slug: string) {
    super('TENANT_NOT_FOUND', 404, `Store ${slug} was not found`);
  }
}

export class TenantSuspendedError extends DomainError {
  constructor() {
    super('FORBIDDEN', 403, 'This store is suspended');
  }
}

export class SlugTakenError extends DomainError {
  constructor(slug: string) {
    super('CONFLICT', 409, `Store slug ${slug} is already taken`, [{ field: 'storeSlug' }]);
  }
}

export { NotFoundError };

export function storeSlugFromHost(host: string | undefined | null): string | null {
  if (!host) return null;
  const name = host.split(':')[0]?.toLowerCase() ?? '';
  const parts = name.split('.');
  if (parts.length < 2) return null;
  const candidate = parts[0] ?? '';
  if (['www', 'api', 'admin', '127', 'localhost'].includes(candidate)) return null;
  return /^[a-z0-9-]{3,32}$/.test(candidate) ? candidate : null;
}
