import { Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Res } from '@nestjs/common';
import {
  authResponseSchema,
  invitationAcceptSchema,
  invitationCreateSchema,
  invitationSchema,
  memberSchema,
  memberUpdateSchema,
  uuid,
} from '@cip/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import type { ApiConfig } from '../../../config';
import { setRefreshCookie, STAFF_REFRESH_COOKIE } from '../../../shared/http/cookies';
import { Doc } from '../../../shared/http/doc';
import { Admin, Audit, Public } from '../../../shared/http/surface';
import { ZBody, ZParam } from '../../../shared/http/zod';
import { currentContext } from '../../../shared/request-context';
import { CONFIG } from '../../../shared/tokens';
import { AuthService } from '../application/auth.service';
import { TeamService } from '../application/team.service';

@Controller('v1')
export class TeamController {
  constructor(
    @Inject(TeamService) private readonly team: TeamService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  @Get('admin/members')
  @Admin()
  @Doc({
    summary: 'Staff members and roles',
    tags: ['team'],
    response: z.object({ data: z.array(memberSchema) }),
  })
  async members() {
    const rows = await this.team.listMembers();
    return { data: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
  }

  @Patch('admin/members/:userId')
  @Admin('staff:manage')
  @Audit('member.role_changed', 'user')
  @Doc({ summary: 'Change a member role', tags: ['team'], body: memberUpdateSchema })
  async update(
    @ZParam('userId', uuid) userId: string,
    @ZBody(memberUpdateSchema) body: z.infer<typeof memberUpdateSchema>,
  ) {
    const { before, after } = await this.team.updateRole(userId, body.role);
    currentContext()?.audit.push({ entityId: userId, before, after });
    return { userId, role: body.role };
  }

  @Delete('admin/members/:userId')
  @Admin('staff:manage')
  @Audit('member.removed', 'user')
  @HttpCode(204)
  @Doc({ summary: 'Remove a member from the store', tags: ['team'], status: 204 })
  async remove(@ZParam('userId', uuid) userId: string) {
    const { before } = await this.team.remove(userId);
    currentContext()?.audit.push({ entityId: userId, before, after: null });
  }

  @Get('admin/invitations')
  @Admin('staff:manage')
  @Doc({
    summary: 'Pending and accepted invitations',
    tags: ['team'],
    response: z.object({ data: z.array(invitationSchema) }),
  })
  async invitations() {
    const rows = await this.team.listInvitations();
    return {
      data: rows.map((r) => ({
        id: r.id,
        email: r.email,
        role: r.role,
        expiresAt: r.expiresAt.toISOString(),
        acceptedAt: r.acceptedAt?.toISOString() ?? null,
      })),
    };
  }

  @Post('admin/invitations')
  @Admin('staff:manage')
  @Audit('invitation.created', 'invitation')
  @Doc({
    summary: 'Invite a staff member by email (72h link)',
    tags: ['team'],
    body: invitationCreateSchema,
    response: invitationSchema,
    status: 201,
  })
  async invite(@ZBody(invitationCreateSchema) body: z.infer<typeof invitationCreateSchema>) {
    const { token: _token, ...invitation } = await this.team.invite(body.email, body.role);
    currentContext()?.audit.push({
      entityId: invitation.id,
      before: null,
      after: { email: body.email, role: body.role },
    });
    return invitation;
  }

  @Delete('admin/invitations/:id')
  @Admin('staff:manage')
  @Audit('invitation.revoked', 'invitation')
  @HttpCode(204)
  @Doc({ summary: 'Revoke a pending invitation', tags: ['team'], status: 204 })
  async revoke(@ZParam('id', uuid) id: string) {
    await this.team.revokeInvitation(id);
    currentContext()?.audit.push({ entityId: id });
  }

  @Post('invitations/:token/accept')
  @Public()
  @HttpCode(200)
  @Doc({
    summary: 'Accept an invitation (creates the account when needed)',
    tags: ['team'],
    body: invitationAcceptSchema,
    response: authResponseSchema,
  })
  async accept(
    @Param('token') token: string,
    @ZBody(invitationAcceptSchema) body: z.infer<typeof invitationAcceptSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.team.accept(token, body);
    setRefreshCookie(
      res,
      STAFF_REFRESH_COOKIE,
      result.session.refreshToken,
      result.session.refreshExpiresAt,
      this.config.COOKIE_SECURE,
    );
    const me = await this.auth.me(result.user.id);
    return { accessToken: result.session.accessToken, expiresIn: result.session.expiresIn, ...me };
  }
}
