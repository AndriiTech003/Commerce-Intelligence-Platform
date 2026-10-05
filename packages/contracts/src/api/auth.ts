import { z } from 'zod';
import { ROLES, PERMISSIONS } from '../permissions';
import { uuid } from '../events/envelope';

export const email = z.string().trim().toLowerCase().email().max(254);
export const password = z.string().min(8).max(200);
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]{3,32}$/, 'slug must be 3-32 chars of a-z, 0-9 and -');

export const signupSchema = z.object({
  email,
  password,
  name: z.string().trim().min(1).max(120),
  storeName: z.string().trim().min(1).max(120),
  storeSlug: slugSchema,
  currency: z.string().length(3).toUpperCase().default('USD'),
  demoCatalog: z.boolean().default(false),
});

export const loginSchema = z.object({ email, password: z.string().min(1).max(200) });

export const roleSchema = z.enum(ROLES);
export const permissionSchema = z.enum(PERMISSIONS);

export const membershipSchema = z.object({
  tenantId: uuid,
  slug: z.string(),
  name: z.string(),
  role: roleSchema,
  permissions: z.array(permissionSchema),
});

export const userSchema = z.object({
  id: uuid,
  email: z.string(),
  name: z.string(),
  isPlatformAdmin: z.boolean(),
});

export const meSchema = z.object({ user: userSchema, memberships: z.array(membershipSchema) });

export const authResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  user: userSchema,
  memberships: z.array(membershipSchema),
});

export const invitationCreateSchema = z.object({ email, role: roleSchema.exclude(['owner']) });

export const invitationAcceptSchema = z.object({
  name: z.string().trim().min(1).max(120),
  password,
});

export const invitationSchema = z.object({
  id: uuid,
  email: z.string(),
  role: z.string(),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable(),
});

export const memberSchema = z.object({
  userId: uuid,
  email: z.string(),
  name: z.string(),
  role: roleSchema,
  createdAt: z.string(),
});

export const memberUpdateSchema = z.object({ role: roleSchema });

export const apiKeyCreateSchema = z.object({
  kind: z.enum(['publishable', 'secret']),
  scopes: z.array(permissionSchema).default([]),
});

export const apiKeySchema = z.object({
  id: uuid,
  kind: z.enum(['publishable', 'secret']),
  prefix: z.string(),
  scopes: z.array(z.string()),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

export const apiKeyCreatedSchema = apiKeySchema.extend({ secret: z.string() });

export const auditQuerySchema = z.object({
  actorId: uuid.optional(),
  entityType: z.string().max(64).optional(),
  entityId: uuid.optional(),
  action: z.string().max(64).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export const auditEntrySchema = z.object({
  id: uuid,
  actorType: z.string(),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  diff: z.record(z.string(), z.tuple([z.unknown(), z.unknown()])).nullable(),
  ip: z.string().nullable(),
  createdAt: z.string(),
});

export const tenantSettingsSchema = z.object({
  name: z.string(),
  slug: z.string(),
  currency: z.string(),
  lowStockThreshold: z.number().int(),
  brandColor: z.string(),
  tagline: z.string(),
  trackingKey: z.string().nullable(),
  language: z.string(),
  brandVoice: z.string(),
  bannedClaims: z.array(z.string()),
  aiCreativesDailyLimit: z.number().int(),
});

export const tenantSettingsUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  lowStockThreshold: z.number().int().min(0).max(100000).optional(),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  tagline: z.string().max(200).optional(),
  language: z
    .string()
    .regex(/^[a-z]{2}$/)
    .optional(),
  brandVoice: z.string().max(500).optional(),
  bannedClaims: z.array(z.string().trim().min(2).max(80)).max(50).optional(),
  aiCreativesDailyLimit: z.number().int().min(0).max(1000).optional(),
});

export const realtimeTicketSchema = z.object({ ticket: z.string(), url: z.string(), expiresIn: z.number() });

export const customerRegisterSchema = z.object({
  email,
  password,
  name: z.string().trim().min(1).max(120),
});

export const customerSchema = z.object({ id: uuid, email: z.string(), name: z.string().nullable() });

export const customerAuthResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  customer: customerSchema,
});
