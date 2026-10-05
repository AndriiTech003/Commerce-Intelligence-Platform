import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@cip/contracts';

export type SurfaceKind = 'public' | 'staff' | 'admin' | 'storefront' | 'platform';

export interface SurfaceMeta {
  kind: SurfaceKind;
  permission?: Permission;
  customer?: 'optional' | 'required';
}

export const SURFACE_KEY = 'cip:surface';

export const Public = () => SetMetadata(SURFACE_KEY, { kind: 'public' } satisfies SurfaceMeta);
export const Staff = () => SetMetadata(SURFACE_KEY, { kind: 'staff' } satisfies SurfaceMeta);
export const Admin = (permission?: Permission) =>
  SetMetadata(SURFACE_KEY, { kind: 'admin', permission } satisfies SurfaceMeta);
export const Storefront = (customer: 'optional' | 'required' = 'optional') =>
  SetMetadata(SURFACE_KEY, { kind: 'storefront', customer } satisfies SurfaceMeta);
export const Platform = () => SetMetadata(SURFACE_KEY, { kind: 'platform' } satisfies SurfaceMeta);

export const AUDIT_KEY = 'cip:audit';
export interface AuditMeta {
  action: string;
  entityType: string;
}
export const Audit = (action: string, entityType: string) =>
  SetMetadata(AUDIT_KEY, { action, entityType } satisfies AuditMeta);

export const IDEMPOTENT_KEY = 'cip:idempotent';
export const Idempotent = (options: { required: boolean }) => SetMetadata(IDEMPOTENT_KEY, options);
