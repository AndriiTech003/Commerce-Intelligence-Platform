import type { Tenant, TenantSettings } from '../domain/tenant';

export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');

export interface UnitOfWork {
  run<T>(fn: () => Promise<T>): Promise<T>;
  runForTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T>;
  runForUser<T>(userId: string, fn: () => Promise<T>): Promise<T>;
  runSystem<T>(fn: () => Promise<T>): Promise<T>;
}

export const TENANT_REPOSITORY = Symbol('TENANT_REPOSITORY');

export interface TenantRepository {
  findBySlug(slug: string): Promise<Tenant | null>;
  findById(id: string): Promise<Tenant | null>;
  create(input: { id: string; slug: string; name: string; settings: TenantSettings }): Promise<Tenant>;
  update(id: string, patch: { name?: string; settings?: TenantSettings }): Promise<Tenant>;
  listAll(): Promise<Array<Tenant & { members: number; products: number; orders: number }>>;
}
