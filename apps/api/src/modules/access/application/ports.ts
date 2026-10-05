import type { Permission } from '@cip/contracts';
import type { ApiKeyKind, ApiKeyRecord } from '../domain/api-key';

export const API_KEY_REPOSITORY = Symbol('API_KEY_REPOSITORY');
export interface ApiKeyRepository {
  create(row: {
    id: string;
    kind: ApiKeyKind;
    prefix: string;
    keyHash: string;
    scopes: Permission[];
    createdBy: string | null;
  }): Promise<ApiKeyRecord>;
  list(): Promise<ApiKeyRecord[]>;
  revoke(id: string): Promise<{ keyHash: string } | null>;
  findActiveByHash(hash: string): Promise<ApiKeyRecord | null>;
  touch(id: string): Promise<void>;
}

export const API_KEY_CACHE = Symbol('API_KEY_CACHE');
export interface ApiKeyCache {
  get(hash: string): Promise<ApiKeyRecord | null | undefined>;
  set(hash: string, record: ApiKeyRecord | null): Promise<void>;
  invalidate(hash: string): Promise<void>;
}

export const STOREFRONT_RATE_LIMITER = Symbol('STOREFRONT_RATE_LIMITER');
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}
export interface StorefrontRateLimiter {
  hit(subject: string): Promise<RateLimitResult>;
}
