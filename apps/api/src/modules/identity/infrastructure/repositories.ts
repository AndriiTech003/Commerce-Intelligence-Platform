import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import type { Role } from '@cip/contracts';
import { customers, invitations, memberships, refreshTokens, tenants, users } from '../../../db/schema';
import { TenantDatabase } from '../../tenancy';
import type { RefreshTokenRecord, User } from '../domain/identity';
import type {
  CustomerAccount,
  CustomerAccountRepository,
  InvitationRepository,
  InvitationRow,
  MemberRow,
  MembershipRepository,
  RefreshTokenRepository,
  UserRepository,
} from '../application/ports';

function toUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.passwordHash,
    isPlatformAdmin: row.isPlatformAdmin,
  };
}

@Injectable()
export class DrizzleUserRepository implements UserRepository {
  constructor(@Inject(TenantDatabase) private readonly db: TenantDatabase) {}

  async findByEmail(email: string): Promise<User | null> {
    const [row] = await this.db.executor().select().from(users).where(eq(users.email, email)).limit(1);
    return row ? toUser(row) : null;
  }

  async findById(id: string): Promise<User | null> {
    const [row] = await this.db.executor().select().from(users).where(eq(users.id, id)).limit(1);
    return row ? toUser(row) : null;
  }

  async create(user: {
    id: string;
    email: string;
    name: string;
    passwordHash: string;
    isPlatformAdmin?: boolean;
  }) {
    const [row] = await this.db
      .executor()
      .insert(users)
      .values({ ...user, isPlatformAdmin: user.isPlatformAdmin ?? false })
      .returning();
    return toUser(row!);
  }

  async membershipsOf(userId: string) {
    const rows = await this.db
      .tx()
      .select({
        tenantId: memberships.tenantId,
        role: memberships.role,
        slug: tenants.slug,
        name: tenants.name,
      })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(eq(memberships.userId, userId))
      .orderBy(asc(tenants.name));
    return rows.map((r) => ({ ...r, role: r.role as Role }));
  }
}

@Injectable()
export class DrizzleMembershipRepository implements MembershipRepository {
  constructor(@Inject(TenantDatabase) private readonly db: TenantDatabase) {}

  async find(userId: string) {
    const [row] = await this.db
      .tx()
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, this.db.tenantId())))
      .limit(1);
    return row ? { role: row.role as Role } : null;
  }

  async list(): Promise<MemberRow[]> {
    const rows = await this.db
      .tx()
      .select({
        userId: memberships.userId,
        role: memberships.role,
        createdAt: memberships.createdAt,
        email: users.email,
        name: users.name,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .orderBy(asc(memberships.createdAt));
    return rows.map((r) => ({ ...r, role: r.role as Role }));
  }

  async create(userId: string, role: Role) {
    await this.db.tx().insert(memberships).values({ tenantId: this.db.tenantId(), userId, role });
  }

  async updateRole(userId: string, role: Role) {
    await this.db.tx().update(memberships).set({ role }).where(eq(memberships.userId, userId));
  }

  async remove(userId: string) {
    await this.db.tx().delete(memberships).where(eq(memberships.userId, userId));
  }

  async countOwners() {
    const [row] = await this.db
      .tx()
      .select({ n: count() })
      .from(memberships)
      .where(eq(memberships.role, 'owner'));
    return Number(row?.n ?? 0);
  }
}

function toRefresh(row: typeof refreshTokens.$inferSelect): RefreshTokenRecord {
  return {
    id: row.id,
    subjectId: row.subjectId,
    subjectType: row.subjectType === 'customer' ? 'customer' : 'user',
    tenantId: row.tenantId,
    familyId: row.familyId,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    replacedBy: row.replacedBy,
  };
}

@Injectable()
export class DrizzleRefreshTokenRepository implements RefreshTokenRepository {
  constructor(@Inject(TenantDatabase) private readonly db: TenantDatabase) {}

  async create(record: RefreshTokenRecord & { tokenHash: string }) {
    await this.db.executor().insert(refreshTokens).values(record);
  }

  async findByHash(hash: string) {
    const [row] = await this.db
      .executor()
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hash))
      .limit(1);
    return row ? toRefresh(row) : null;
  }

  async rotate(oldId: string, next: RefreshTokenRecord & { tokenHash: string }) {
    const updated = await this.db
      .tx()
      .update(refreshTokens)
      .set({ replacedBy: next.id, revokedAt: new Date() })
      .where(
        and(eq(refreshTokens.id, oldId), isNull(refreshTokens.replacedBy), isNull(refreshTokens.revokedAt)),
      )
      .returning({ id: refreshTokens.id });
    if (updated.length === 0) return false;
    await this.db.tx().insert(refreshTokens).values(next);
    return true;
  }

  async revokeFamily(familyId: string) {
    await this.db
      .executor()
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }
}

@Injectable()
export class DrizzleInvitationRepository implements InvitationRepository {
  constructor(@Inject(TenantDatabase) private readonly db: TenantDatabase) {}

  async create(row: {
    id: string;
    email: string;
    role: Role;
    tokenHash: string;
    expiresAt: Date;
    invitedBy: string | null;
  }) {
    await this.db
      .tx()
      .insert(invitations)
      .values({ ...row, tenantId: this.db.tenantId() });
  }

  async findByHash(hash: string): Promise<InvitationRow | null> {
    const [row] = await this.db
      .tx()
      .select()
      .from(invitations)
      .where(eq(invitations.tokenHash, hash))
      .limit(1);
    return row
      ? {
          id: row.id,
          email: row.email,
          role: row.role as Role,
          expiresAt: row.expiresAt,
          acceptedAt: row.acceptedAt,
        }
      : null;
  }

  async markAccepted(id: string) {
    const rows = await this.db
      .tx()
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(and(eq(invitations.id, id), isNull(invitations.acceptedAt)))
      .returning({ id: invitations.id });
    return rows.length > 0;
  }

  async list(): Promise<InvitationRow[]> {
    const rows = await this.db
      .tx()
      .select()
      .from(invitations)
      .orderBy(sql`${invitations.createdAt} desc`);
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role as Role,
      expiresAt: r.expiresAt,
      acceptedAt: r.acceptedAt,
    }));
  }

  async remove(id: string) {
    await this.db
      .tx()
      .delete(invitations)
      .where(and(eq(invitations.id, id), isNull(invitations.acceptedAt)));
  }
}

@Injectable()
export class DrizzleCustomerAccountRepository implements CustomerAccountRepository {
  constructor(@Inject(TenantDatabase) private readonly db: TenantDatabase) {}

  private map(row: typeof customers.$inferSelect): CustomerAccount {
    return { id: row.id, email: row.email, name: row.name, passwordHash: row.passwordHash };
  }

  async findByEmail(email: string) {
    const [row] = await this.db.tx().select().from(customers).where(eq(customers.email, email)).limit(1);
    return row ? this.map(row) : null;
  }

  async findById(id: string) {
    const [row] = await this.db.tx().select().from(customers).where(eq(customers.id, id)).limit(1);
    return row ? this.map(row) : null;
  }

  async create(row: { id: string; email: string; name: string | null; passwordHash: string | null }) {
    const [created] = await this.db
      .tx()
      .insert(customers)
      .values({ ...row, tenantId: this.db.tenantId() })
      .returning();
    return this.map(created!);
  }

  async setPassword(id: string, passwordHash: string, name: string | null) {
    await this.db
      .tx()
      .update(customers)
      .set({ passwordHash, ...(name ? { name } : {}) })
      .where(eq(customers.id, id));
  }

  async linkAnonymousId(id: string, anonymousId: string) {
    const rows = await this.db
      .tx()
      .update(customers)
      .set({ anonymousIds: sql`array_append(${customers.anonymousIds}, ${anonymousId}::uuid)` })
      .where(and(eq(customers.id, id), sql`not (${anonymousId}::uuid = any(${customers.anonymousIds}))`))
      .returning({ id: customers.id });
    return rows.length > 0;
  }
}
