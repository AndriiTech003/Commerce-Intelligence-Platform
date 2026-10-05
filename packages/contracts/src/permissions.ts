export const PERMISSIONS = [
  'catalog:read',
  'catalog:write',
  'inventory:write',
  'orders:read',
  'orders:manage',
  'customers:read',
  'marketing:write',
  'marketing:approve',
  'analytics:read',
  'staff:manage',
  'apikeys:manage',
  'settings:write',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ['owner', 'admin', 'catalog_manager', 'marketer', 'support'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS,
  catalog_manager: ['catalog:read', 'catalog:write', 'inventory:write', 'analytics:read'],
  marketer: ['catalog:read', 'customers:read', 'marketing:write', 'marketing:approve', 'analytics:read'],
  support: ['catalog:read', 'orders:read', 'orders:manage', 'customers:read'],
};

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function hasPermission(granted: readonly string[], required: Permission): boolean {
  return granted.includes(required);
}

export const API_KEY_SCOPES = PERMISSIONS;
