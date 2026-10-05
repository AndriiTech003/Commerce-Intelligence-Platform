import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '@cip/contracts';
import { currentContext } from '../../../shared/request-context';
import { UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import { OUTBOX_WRITER, type OutboxWriter } from '../../outbox';
import { EmailTakenError, InvalidCredentialsError, InvalidRefreshTokenError } from '../domain/identity';
import {
  CART_MERGER,
  CUSTOMER_ACCOUNT_REPOSITORY,
  LOGIN_THROTTLE,
  PASSWORD_HASHER,
  type CartMerger,
  type CustomerAccount,
  type CustomerAccountRepository,
  type LoginThrottle,
  type PasswordHasher,
} from './ports';
import { SessionService } from './session.service';

@Injectable()
export class CustomerAuthService {
  constructor(
    @Inject(CUSTOMER_ACCOUNT_REPOSITORY) private readonly customers: CustomerAccountRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(LOGIN_THROTTLE) private readonly throttle: LoginThrottle,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CART_MERGER) private readonly carts: CartMerger,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  private view(customer: CustomerAccount) {
    return { id: customer.id, email: customer.email, name: customer.name };
  }

  private async identify(customerId: string): Promise<void> {
    const anonymousId = currentContext()?.anonymousId ?? null;
    await this.carts.mergeOnLogin(customerId, anonymousId);
    if (anonymousId && (await this.customers.linkAnonymousId(customerId, anonymousId))) {
      await this.outbox.append({
        aggregateType: 'customer',
        aggregateId: customerId,
        eventType: 'customer.identified',
        payload: { customer_id: customerId, anonymous_id: anonymousId },
      });
    }
  }

  async register(input: { email: string; password: string; name: string }) {
    const tenantId = currentContext()!.tenantId!;
    const passwordHash = await this.hasher.hash(input.password);
    const customer = await this.uow.run(async () => {
      const existing = await this.customers.findByEmail(input.email);
      let account: CustomerAccount;
      if (existing) {
        if (existing.passwordHash) throw new EmailTakenError();
        await this.customers.setPassword(existing.id, passwordHash, input.name);
        account = { ...existing, passwordHash, name: input.name };
      } else {
        account = await this.customers.create({
          id: uuidv7(),
          email: input.email,
          name: input.name,
          passwordHash,
        });
      }
      await this.identify(account.id);
      return account;
    });
    const session = await this.sessions.issue({ id: customer.id, type: 'customer', tenantId });
    return { ...session, customer: this.view(customer) };
  }

  async login(email: string, password: string) {
    const tenantId = currentContext()!.tenantId!;
    const subject = `c:${tenantId}:${currentContext()?.ip ?? 'unknown'}:${email.toLowerCase()}`;
    await this.throttle.check(subject);
    const customer = await this.uow.run(async () => {
      const account = await this.customers.findByEmail(email);
      const ok = account?.passwordHash ? await this.hasher.verify(account.passwordHash, password) : false;
      if (!account || !ok) return null;
      await this.identify(account.id);
      return account;
    });
    if (!customer) {
      await this.throttle.fail(subject);
      throw new InvalidCredentialsError();
    }
    await this.throttle.reset(subject);
    const session = await this.sessions.issue({ id: customer.id, type: 'customer', tenantId });
    return { ...session, customer: this.view(customer) };
  }

  async refresh(rawToken: string | undefined) {
    const tenantId = currentContext()!.tenantId!;
    const rotated = await this.sessions.rotate(rawToken, 'customer');
    if (rotated.tenantId !== tenantId) throw new InvalidRefreshTokenError();
    const customer = await this.uow.run(() => this.customers.findById(rotated.subjectId));
    if (!customer) throw new InvalidRefreshTokenError();
    return { ...rotated, customer: this.view(customer) };
  }

  logout(rawToken: string | undefined) {
    return this.sessions.revoke(rawToken);
  }

  async me(customerId: string) {
    const customer = await this.uow.run(() => this.customers.findById(customerId));
    if (!customer) throw new InvalidRefreshTokenError();
    return this.view(customer);
  }
}
