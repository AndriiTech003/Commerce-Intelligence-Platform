import type { Role } from '@cip/contracts';
import type { RefreshTokenRecord, User } from '../domain/identity';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(user: {
    id: string;
    email: string;
    name: string;
    passwordHash: string;
    isPlatformAdmin?: boolean;
  }): Promise<User>;
  membershipsOf(userId: string): Promise<Array<{ tenantId: string; slug: string; name: string; role: Role }>>;
}

export const MEMBERSHIP_REPOSITORY = Symbol('MEMBERSHIP_REPOSITORY');
export interface MemberRow {
  userId: string;
  email: string;
  name: string;
  role: Role;
  createdAt: Date;
}
export interface MembershipRepository {
  find(userId: string): Promise<{ role: Role } | null>;
  list(): Promise<MemberRow[]>;
  create(userId: string, role: Role): Promise<void>;
  updateRole(userId: string, role: Role): Promise<void>;
  remove(userId: string): Promise<void>;
  countOwners(): Promise<number>;
}

export const REFRESH_TOKEN_REPOSITORY = Symbol('REFRESH_TOKEN_REPOSITORY');
export interface RefreshTokenRepository {
  create(record: RefreshTokenRecord & { tokenHash: string }): Promise<void>;
  findByHash(hash: string): Promise<RefreshTokenRecord | null>;
  rotate(oldId: string, next: RefreshTokenRecord & { tokenHash: string }): Promise<boolean>;
  revokeFamily(familyId: string): Promise<void>;
}

export const INVITATION_REPOSITORY = Symbol('INVITATION_REPOSITORY');
export interface InvitationRow {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
  acceptedAt: Date | null;
}
export interface InvitationRepository {
  create(row: {
    id: string;
    email: string;
    role: Role;
    tokenHash: string;
    expiresAt: Date;
    invitedBy: string | null;
  }): Promise<void>;
  findByHash(hash: string): Promise<InvitationRow | null>;
  markAccepted(id: string): Promise<boolean>;
  list(): Promise<InvitationRow[]>;
  remove(id: string): Promise<void>;
}

export const CUSTOMER_ACCOUNT_REPOSITORY = Symbol('CUSTOMER_ACCOUNT_REPOSITORY');
export interface CustomerAccount {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string | null;
}
export interface CustomerAccountRepository {
  findByEmail(email: string): Promise<CustomerAccount | null>;
  findById(id: string): Promise<CustomerAccount | null>;
  create(row: {
    id: string;
    email: string;
    name: string | null;
    passwordHash: string | null;
  }): Promise<CustomerAccount>;
  setPassword(id: string, passwordHash: string, name: string | null): Promise<void>;
  linkAnonymousId(id: string, anonymousId: string): Promise<boolean>;
}

export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

export const TOKEN_SIGNER = Symbol('TOKEN_SIGNER');
export interface AccessClaims {
  sub: string;
  typ: 'staff' | 'customer';
  tid?: string;
  pa?: boolean;
}
export interface TokenSigner {
  sign(claims: AccessClaims): Promise<{ token: string; expiresIn: number }>;
  verify(token: string): Promise<AccessClaims | null>;
}

export const LOGIN_THROTTLE = Symbol('LOGIN_THROTTLE');
export interface LoginThrottle {
  check(subject: string): Promise<void>;
  fail(subject: string): Promise<void>;
  reset(subject: string): Promise<void>;
}

export const MAIL_SENDER = Symbol('MAIL_SENDER');
export interface MailSender {
  send(message: { to: string; subject: string; text: string; html?: string }): Promise<void>;
}

export const TRACKING_KEY_PROVISIONER = Symbol('TRACKING_KEY_PROVISIONER');
export interface TrackingKeyProvisioner {
  provision(tenantId: string, createdBy: string | null): Promise<string>;
}

export const DEMO_CATALOG_PROVISIONER = Symbol('DEMO_CATALOG_PROVISIONER');
export interface DemoCatalogProvisioner {
  provision(tenantId: string, currency: string, size: number): Promise<number>;
}

export const CART_MERGER = Symbol('CART_MERGER');
export interface CartMerger {
  mergeOnLogin(customerId: string, anonymousId: string | null): Promise<void>;
}
