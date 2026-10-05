import { Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { authResponseSchema, loginSchema, meSchema, signupSchema } from '@cip/contracts';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import type { ApiConfig } from '../../../config';
import { requireActor } from '../../../shared/http/actor';
import {
  clearRefreshCookie,
  readCookie,
  setRefreshCookie,
  STAFF_REFRESH_COOKIE,
} from '../../../shared/http/cookies';
import { Doc } from '../../../shared/http/doc';
import { Public, Staff } from '../../../shared/http/surface';
import { ZBody } from '../../../shared/http/zod';
import { CONFIG } from '../../../shared/tokens';
import { AuthService, type StaffSession } from '../application/auth.service';

@Controller('v1')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  private respond(res: Response, session: StaffSession) {
    setRefreshCookie(
      res,
      STAFF_REFRESH_COOKIE,
      session.refreshToken,
      session.refreshExpiresAt,
      this.config.COOKIE_SECURE,
    );
    return {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      user: session.user,
      memberships: session.memberships,
    };
  }

  @Post('auth/signup')
  @Public()
  @Doc({
    summary: 'Register a merchant: user, store and owner membership',
    tags: ['auth'],
    body: signupSchema,
    response: authResponseSchema,
    status: 201,
  })
  async signup(
    @ZBody(signupSchema) body: z.infer<typeof signupSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.signup(body));
  }

  @Post('auth/login')
  @Public()
  @HttpCode(200)
  @Doc({
    summary: 'Log in; returns an access token and sets the refresh cookie',
    tags: ['auth'],
    body: loginSchema,
    response: authResponseSchema,
  })
  async login(
    @ZBody(loginSchema) body: z.infer<typeof loginSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.login(body.email, body.password));
  }

  @Post('auth/refresh')
  @Public()
  @HttpCode(200)
  @Doc({
    summary: 'Rotate the refresh token; reuse of an old token revokes the whole family',
    tags: ['auth'],
    response: authResponseSchema,
  })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      return this.respond(res, await this.auth.refresh(readCookie(req, STAFF_REFRESH_COOKIE)));
    } catch (error) {
      clearRefreshCookie(res, STAFF_REFRESH_COOKIE, this.config.COOKIE_SECURE);
      throw error;
    }
  }

  @Post('auth/logout')
  @Public()
  @HttpCode(204)
  @Doc({ summary: 'Revoke the refresh token family and clear the cookie', tags: ['auth'], status: 204 })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(readCookie(req, STAFF_REFRESH_COOKIE));
    clearRefreshCookie(res, STAFF_REFRESH_COOKIE, this.config.COOKIE_SECURE);
  }

  @Get('me')
  @Staff()
  @Doc({ summary: 'Current user with stores and roles', tags: ['auth'], response: meSchema })
  me() {
    return this.auth.me(requireActor().id!);
  }
}
