import { Global, Module } from '@nestjs/common';
import {
  CUSTOMER_ACCOUNT_REPOSITORY,
  INVITATION_REPOSITORY,
  LOGIN_THROTTLE,
  MAIL_SENDER,
  MEMBERSHIP_REPOSITORY,
  PASSWORD_HASHER,
  REFRESH_TOKEN_REPOSITORY,
  TOKEN_SIGNER,
  USER_REPOSITORY,
} from './application/ports';
import { AuthService } from './application/auth.service';
import { CustomerAuthService } from './application/customer-auth.service';
import { SessionService } from './application/session.service';
import { TeamService } from './application/team.service';
import { AuthController } from './http/auth.controller';
import { CustomerAuthController } from './http/customer-auth.controller';
import { TeamController } from './http/team.controller';
import {
  Argon2PasswordHasher,
  JoseTokenSigner,
  RedisLoginThrottle,
  SmtpMailSender,
} from './infrastructure/adapters';
import {
  DrizzleCustomerAccountRepository,
  DrizzleInvitationRepository,
  DrizzleMembershipRepository,
  DrizzleRefreshTokenRepository,
  DrizzleUserRepository,
} from './infrastructure/repositories';

@Global()
@Module({
  controllers: [AuthController, TeamController, CustomerAuthController],
  providers: [
    { provide: USER_REPOSITORY, useClass: DrizzleUserRepository },
    { provide: MEMBERSHIP_REPOSITORY, useClass: DrizzleMembershipRepository },
    { provide: REFRESH_TOKEN_REPOSITORY, useClass: DrizzleRefreshTokenRepository },
    { provide: INVITATION_REPOSITORY, useClass: DrizzleInvitationRepository },
    { provide: CUSTOMER_ACCOUNT_REPOSITORY, useClass: DrizzleCustomerAccountRepository },
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    { provide: TOKEN_SIGNER, useClass: JoseTokenSigner },
    { provide: LOGIN_THROTTLE, useClass: RedisLoginThrottle },
    { provide: MAIL_SENDER, useClass: SmtpMailSender },
    SessionService,
    AuthService,
    TeamService,
    CustomerAuthService,
  ],
  exports: [
    AuthService,
    SessionService,
    PASSWORD_HASHER,
    USER_REPOSITORY,
    MAIL_SENDER,
    CUSTOMER_ACCOUNT_REPOSITORY,
  ],
})
export class IdentityModule {}
