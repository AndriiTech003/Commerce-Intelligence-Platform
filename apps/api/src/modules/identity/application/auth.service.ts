import { Inject, Injectable } from '@nestjs/common';
import { permissionsFor, uuidv7, type Role } from '@cip/contracts';
import { currentContext } from '../../../shared/request-context';
import {
  DEFAULT_SETTINGS,
  SlugTakenError,
  TENANT_REPOSITORY,
  UNIT_OF_WORK,
  type TenantRepository,
  type UnitOfWork,
} from '../../tenancy';
import { EmailTakenError, InvalidCredentialsError, type Membership, type User } from '../domain/identity';
import {
  DEMO_CATALOG_PROVISIONER,
  LOGIN_THROTTLE,
  MEMBERSHIP_REPOSITORY,
  PASSWORD_HASHER,
  TRACKING_KEY_PROVISIONER,
  USER_REPOSITORY,
  type DemoCatalogProvisioner,
  type LoginThrottle,
  type MembershipRepository,
  type PasswordHasher,
  type TrackingKeyProvisioner,
  type UserRepository,
} from './ports';
import { SessionService, type IssuedSession } from './session.service';

export interface SignupInput {
  email: string;
  password: string;
  name: string;
  storeName: string;
  storeSlug: string;
  currency: string;
  demoCatalog: boolean;
}

export interface StaffSession extends IssuedSession {
  user: { id: string; email: string; name: string; isPlatformAdmin: boolean };
  memberships: Membership[];
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(MEMBERSHIP_REPOSITORY) private readonly memberships: MembershipRepository,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(LOGIN_THROTTLE) private readonly throttle: LoginThrottle,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(TRACKING_KEY_PROVISIONER) private readonly trackingKeys: TrackingKeyProvisioner,
    @Inject(DEMO_CATALOG_PROVISIONER) private readonly demoCatalog: DemoCatalogProvisioner,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  private publicUser(user: User) {
    return { id: user.id, email: user.email, name: user.name, isPlatformAdmin: user.isPlatformAdmin };
  }

  async membershipsOf(userId: string): Promise<Membership[]> {
    const rows = await this.uow.runForUser(userId, () => this.users.membershipsOf(userId));
    return rows.map((r) => ({ ...r, permissions: permissionsFor(r.role) }));
  }

  async signup(input: SignupInput): Promise<StaffSession & { tenantId: string }> {
    if (await this.users.findByEmail(input.email)) throw new EmailTakenError();
    if (await this.tenants.findBySlug(input.storeSlug)) throw new SlugTakenError(input.storeSlug);
    const passwordHash = await this.hasher.hash(input.password);
    const tenantId = uuidv7();
    const userId = uuidv7();
    const user = await this.uow.runForTenant(tenantId, async () => {
      await this.tenants.create({
        id: tenantId,
        slug: input.storeSlug,
        name: input.storeName,
        settings: { ...DEFAULT_SETTINGS, currency: input.currency },
      });
      const created = await this.users.create({
        id: userId,
        email: input.email,
        name: input.name,
        passwordHash,
      });
      await this.memberships.create(userId, 'owner');
      const trackingKey = await this.trackingKeys.provision(tenantId, userId);
      await this.tenants.update(tenantId, {
        settings: { ...DEFAULT_SETTINGS, currency: input.currency, trackingKey },
      });
      if (input.demoCatalog) await this.demoCatalog.provision(tenantId, input.currency, 24);
      return created;
    });
    const session = await this.sessions.issue({ id: user.id, type: 'user', tenantId: null });
    return {
      ...session,
      tenantId,
      user: this.publicUser(user),
      memberships: await this.membershipsOf(user.id),
    };
  }

  async login(email: string, password: string): Promise<StaffSession> {
    const subject = `${currentContext()?.ip ?? 'unknown'}:${email.toLowerCase()}`;
    await this.throttle.check(subject);
    const user = await this.users.findByEmail(email);
    const valid = user ? await this.hasher.verify(user.passwordHash, password) : false;
    if (!user || !valid) {
      await this.throttle.fail(subject);
      throw new InvalidCredentialsError();
    }
    await this.throttle.reset(subject);
    const session = await this.sessions.issue({
      id: user.id,
      type: 'user',
      tenantId: null,
      isPlatformAdmin: user.isPlatformAdmin,
    });
    return { ...session, user: this.publicUser(user), memberships: await this.membershipsOf(user.id) };
  }

  async refresh(rawToken: string | undefined): Promise<StaffSession> {
    const rotated = await this.sessions.rotate(rawToken, 'user', async (id) => {
      const user = await this.users.findById(id);
      return { isPlatformAdmin: user?.isPlatformAdmin ?? false };
    });
    const user = await this.users.findById(rotated.subjectId);
    if (!user) throw new InvalidCredentialsError();
    return { ...rotated, user: this.publicUser(user), memberships: await this.membershipsOf(user.id) };
  }

  logout(rawToken: string | undefined): Promise<void> {
    return this.sessions.revoke(rawToken);
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new InvalidCredentialsError();
    return { user: this.publicUser(user), memberships: await this.membershipsOf(user.id) };
  }

  async roleIn(tenantId: string, userId: string): Promise<Role | null> {
    const membership = await this.uow.runForTenant(tenantId, () => this.memberships.find(userId));
    return membership?.role ?? null;
  }

  async userById(userId: string) {
    const user = await this.users.findById(userId);
    return user ? this.publicUser(user) : null;
  }
}
