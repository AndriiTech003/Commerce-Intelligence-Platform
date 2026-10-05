import { Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  customerAuthResponseSchema,
  customerRegisterSchema,
  customerSchema,
  loginSchema,
} from '@cip/contracts';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import type { ApiConfig } from '../../../config';
import { requireCustomer } from '../../../shared/http/actor';
import {
  clearRefreshCookie,
  CUSTOMER_REFRESH_COOKIE,
  readCookie,
  setRefreshCookie,
} from '../../../shared/http/cookies';
import { Doc } from '../../../shared/http/doc';
import { Storefront } from '../../../shared/http/surface';
import { ZBody } from '../../../shared/http/zod';
import { CONFIG } from '../../../shared/tokens';
import { CustomerAuthService } from '../application/customer-auth.service';
import type { IssuedSession } from '../application/session.service';

@Controller('v1/storefront')
export class CustomerAuthController {
  constructor(
    @Inject(CustomerAuthService) private readonly auth: CustomerAuthService,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  private respond(
    res: Response,
    session: IssuedSession & { customer: { id: string; email: string; name: string | null } },
  ) {
    setRefreshCookie(
      res,
      CUSTOMER_REFRESH_COOKIE,
      session.refreshToken,
      session.refreshExpiresAt,
      this.config.COOKIE_SECURE,
    );
    return { accessToken: session.accessToken, expiresIn: session.expiresIn, customer: session.customer };
  }

  @Post('auth/register')
  @Storefront()
  @Doc({
    summary: 'Register a customer; merges the anonymous cart',
    tags: ['storefront-auth'],
    body: customerRegisterSchema,
    response: customerAuthResponseSchema,
    status: 201,
  })
  async register(
    @ZBody(customerRegisterSchema) body: z.infer<typeof customerRegisterSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.register(body));
  }

  @Post('auth/login')
  @Storefront()
  @HttpCode(200)
  @Doc({
    summary: 'Customer login; merges the anonymous cart and emits customer.identified',
    tags: ['storefront-auth'],
    body: loginSchema,
    response: customerAuthResponseSchema,
  })
  async login(
    @ZBody(loginSchema) body: z.infer<typeof loginSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.login(body.email, body.password));
  }

  @Post('auth/refresh')
  @Storefront()
  @HttpCode(200)
  @Doc({
    summary: 'Rotate the customer refresh token',
    tags: ['storefront-auth'],
    response: customerAuthResponseSchema,
  })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      return this.respond(res, await this.auth.refresh(readCookie(req, CUSTOMER_REFRESH_COOKIE)));
    } catch (error) {
      clearRefreshCookie(res, CUSTOMER_REFRESH_COOKIE, this.config.COOKIE_SECURE);
      throw error;
    }
  }

  @Post('auth/logout')
  @Storefront()
  @HttpCode(204)
  @Doc({ summary: 'Customer logout', tags: ['storefront-auth'], status: 204 })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(readCookie(req, CUSTOMER_REFRESH_COOKIE));
    clearRefreshCookie(res, CUSTOMER_REFRESH_COOKIE, this.config.COOKIE_SECURE);
  }

  @Get('account/me')
  @Storefront('required')
  @Doc({ summary: 'Current customer', tags: ['storefront-auth'], response: customerSchema })
  me() {
    return this.auth.me(requireCustomer());
  }
}
