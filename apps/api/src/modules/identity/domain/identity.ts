import type { Permission, Role } from '@cip/contracts';
import { DomainError } from '../../../shared/errors';

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  isPlatformAdmin: boolean;
}

export interface Membership {
  tenantId: string;
  slug: string;
  name: string;
  role: Role;
  permissions: Permission[];
}

export interface RefreshTokenRecord {
  id: string;
  subjectId: string;
  subjectType: 'user' | 'customer';
  tenantId: string | null;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBy: string | null;
}

export type RefreshDecision = { kind: 'rotate' } | { kind: 'reuse' } | { kind: 'expired' };

export function decideRefresh(token: RefreshTokenRecord, now: Date): RefreshDecision {
  if (token.revokedAt || token.replacedBy) return { kind: 'reuse' };
  if (token.expiresAt.getTime() <= now.getTime()) return { kind: 'expired' };
  return { kind: 'rotate' };
}

export class InvalidCredentialsError extends DomainError {
  constructor() {
    super('INVALID_CREDENTIALS', 401, 'Email or password is incorrect');
  }
}

export class RefreshTokenReusedError extends DomainError {
  constructor() {
    super(
      'REFRESH_TOKEN_REUSED',
      401,
      'Refresh token was already used; all sessions of this login were revoked',
    );
  }
}

export class InvalidRefreshTokenError extends DomainError {
  constructor() {
    super('UNAUTHORIZED', 401, 'Refresh token is missing, expired or invalid');
  }
}

export class EmailTakenError extends DomainError {
  constructor() {
    super('CONFLICT', 409, 'An account with this email already exists', [{ field: 'email' }]);
  }
}

export class InvitationInvalidError extends DomainError {
  constructor() {
    super('NOT_FOUND', 404, 'Invitation is invalid, expired or already accepted');
  }
}

export class LastOwnerError extends DomainError {
  constructor() {
    super('CONFLICT', 409, 'A store must keep at least one owner');
  }
}

export class OwnerProtectedError extends DomainError {
  constructor() {
    super('FORBIDDEN', 403, 'Only an owner can change or remove another owner');
  }
}

export const INVITATION_TTL_HOURS = 72;

export function invitationToken(tenantId: string, secret: string): string {
  return `${tenantId}.${secret}`;
}

export function parseInvitationToken(token: string): { tenantId: string; secret: string } | null {
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,})$/.exec(token);
  return match ? { tenantId: match[1]!, secret: match[2]! } : null;
}
