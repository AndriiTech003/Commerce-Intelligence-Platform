import { Inject, Injectable } from '@nestjs/common';
import { uuidv7, type Role } from '@cip/contracts';
import type { ApiConfig } from '../../../config';
import { randomToken, sha256 } from '../../../shared/crypto';
import { NotFoundError } from '../../../shared/errors';
import { currentContext } from '../../../shared/request-context';
import { CONFIG } from '../../../shared/tokens';
import { TenantService, UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import {
  EmailTakenError,
  INVITATION_TTL_HOURS,
  InvalidCredentialsError,
  InvitationInvalidError,
  invitationToken,
  LastOwnerError,
  OwnerProtectedError,
  parseInvitationToken,
} from '../domain/identity';
import {
  INVITATION_REPOSITORY,
  MAIL_SENDER,
  MEMBERSHIP_REPOSITORY,
  PASSWORD_HASHER,
  USER_REPOSITORY,
  type InvitationRepository,
  type MailSender,
  type MembershipRepository,
  type PasswordHasher,
  type UserRepository,
} from './ports';
import { SessionService } from './session.service';

@Injectable()
export class TeamService {
  constructor(
    @Inject(MEMBERSHIP_REPOSITORY) private readonly memberships: MembershipRepository,
    @Inject(INVITATION_REPOSITORY) private readonly invitations: InvitationRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(TenantService) private readonly tenants: TenantService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  listMembers() {
    return this.uow.run(() => this.memberships.list());
  }

  listInvitations() {
    return this.uow.run(() => this.invitations.list());
  }

  async invite(email: string, role: Role) {
    const tenant = await this.tenants.current();
    const secret = randomToken(24);
    const token = invitationToken(tenant.id, secret);
    const id = uuidv7();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * 3600_000);
    await this.uow.run(() =>
      this.invitations.create({
        id,
        email,
        role,
        tokenHash: sha256(token),
        expiresAt,
        invitedBy: currentContext()?.actor?.id ?? null,
      }),
    );
    const link = `${this.config.ADMIN_URL.replace(/\/$/, '')}/invite/${encodeURIComponent(token)}`;
    await this.mail.send({
      to: email,
      subject: `You are invited to join ${tenant.name}`,
      text: `You have been invited to ${tenant.name} as ${role}.\n\nAccept the invitation: ${link}\n\nThe link expires in ${INVITATION_TTL_HOURS} hours.`,
      html: `<p>You have been invited to <b>${tenant.name}</b> as <b>${role}</b>.</p><p><a href="${link}">Accept the invitation</a></p><p>The link expires in ${INVITATION_TTL_HOURS} hours.</p>`,
    });
    return { id, email, role, expiresAt: expiresAt.toISOString(), acceptedAt: null, token };
  }

  async revokeInvitation(id: string) {
    await this.uow.run(() => this.invitations.remove(id));
  }

  async accept(token: string, input: { name: string; password: string }) {
    const parsed = parseInvitationToken(token);
    if (!parsed) throw new InvitationInvalidError();
    const result = await this.uow.runForTenant(parsed.tenantId, async () => {
      const invitation = await this.invitations.findByHash(sha256(token));
      if (!invitation || invitation.acceptedAt || invitation.expiresAt.getTime() < Date.now()) {
        throw new InvitationInvalidError();
      }
      let user = await this.users.findByEmail(invitation.email);
      if (user) {
        if (!(await this.hasher.verify(user.passwordHash, input.password)))
          throw new InvalidCredentialsError();
      } else {
        user = await this.users.create({
          id: uuidv7(),
          email: invitation.email,
          name: input.name,
          passwordHash: await this.hasher.hash(input.password),
        });
      }
      if (await this.memberships.find(user.id)) throw new EmailTakenError();
      if (!(await this.invitations.markAccepted(invitation.id))) throw new InvitationInvalidError();
      await this.memberships.create(user.id, invitation.role);
      return { user, role: invitation.role };
    });
    const session = await this.sessions.issue({
      id: result.user.id,
      type: 'user',
      tenantId: null,
      isPlatformAdmin: result.user.isPlatformAdmin,
    });
    return { session, user: result.user, tenantId: parsed.tenantId, role: result.role };
  }

  private async guardOwner(targetUserId: string, nextRole: Role | null) {
    const actorRole = currentContext()?.actor?.role;
    const target = await this.memberships.find(targetUserId);
    if (!target) throw new NotFoundError('Member', targetUserId);
    if ((target.role === 'owner' || nextRole === 'owner') && actorRole !== 'owner')
      throw new OwnerProtectedError();
    if (target.role === 'owner' && nextRole !== 'owner' && (await this.memberships.countOwners()) <= 1) {
      throw new LastOwnerError();
    }
    return target;
  }

  async updateRole(userId: string, role: Role) {
    return this.uow.run(async () => {
      const before = await this.guardOwner(userId, role);
      await this.memberships.updateRole(userId, role);
      return { before: { role: before.role }, after: { role } };
    });
  }

  async remove(userId: string) {
    return this.uow.run(async () => {
      const before = await this.guardOwner(userId, null);
      await this.memberships.remove(userId);
      return { before: { role: before.role } };
    });
  }
}
