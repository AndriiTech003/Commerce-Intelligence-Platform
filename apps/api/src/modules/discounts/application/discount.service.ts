import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '@cip/contracts';
import { NotFoundError } from '../../../shared/errors';
import { UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import {
  DiscountExhaustedError,
  DiscountInvalidError,
  evaluateDiscount,
  type Discount,
  type DiscountEvaluation,
} from '../domain/discount';
import { DISCOUNT_REPOSITORY, type DiscountRepository, type DiscountWrite } from './ports';

export interface DiscountInput {
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  minSubtotalCents: number;
  startsAt?: string | null | undefined;
  endsAt?: string | null | undefined;
  usageLimit?: number | null | undefined;
  perCustomerLimit?: number | null | undefined;
  active: boolean;
}

function toWrite(input: Partial<DiscountInput>): Partial<DiscountWrite> {
  const out: Partial<DiscountWrite> = {};
  if (input.code !== undefined) out.code = input.code.toUpperCase();
  if (input.type !== undefined) out.type = input.type;
  if (input.value !== undefined) out.value = input.value;
  if (input.minSubtotalCents !== undefined) out.minSubtotalCents = input.minSubtotalCents;
  if (input.startsAt !== undefined) out.startsAt = input.startsAt ? new Date(input.startsAt) : null;
  if (input.endsAt !== undefined) out.endsAt = input.endsAt ? new Date(input.endsAt) : null;
  if (input.usageLimit !== undefined) out.usageLimit = input.usageLimit ?? null;
  if (input.perCustomerLimit !== undefined) out.perCustomerLimit = input.perCustomerLimit ?? null;
  if (input.active !== undefined) out.active = input.active;
  return out;
}

@Injectable()
export class DiscountService {
  constructor(
    @Inject(DISCOUNT_REPOSITORY) private readonly repo: DiscountRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  view(d: Discount) {
    return {
      ...d,
      startsAt: d.startsAt?.toISOString() ?? null,
      endsAt: d.endsAt?.toISOString() ?? null,
    };
  }

  async list() {
    return { data: (await this.uow.run(() => this.repo.list())).map((d) => this.view(d)) };
  }

  async create(input: DiscountInput) {
    const created = await this.uow.run(() => this.repo.insert(uuidv7(), toWrite(input) as DiscountWrite));
    return this.view(created);
  }

  async update(id: string, patch: Partial<DiscountInput>) {
    return this.uow.run(async () => {
      const before = await this.repo.find(id);
      if (!before) throw new NotFoundError('Discount', id);
      const merged = { ...before, ...toWrite(patch) };
      if (merged.type === 'percent' && (merged.value < 1 || merged.value > 100)) {
        throw new DiscountInvalidError('percent discount must be between 1 and 100');
      }
      const after = await this.repo.update(id, toWrite(patch));
      return { before: this.view(before), after: this.view(after!) };
    });
  }

  async remove(id: string) {
    return this.uow.run(async () => {
      const before = await this.repo.find(id);
      if (!before || !(await this.repo.remove(id))) throw new NotFoundError('Discount', id);
      return this.view(before);
    });
  }

  async evaluate(
    code: string,
    input: { subtotalCents: number; email: string | null; customerId: string | null },
  ): Promise<{ discount: Discount | null; evaluation: DiscountEvaluation }> {
    const discount = await this.repo.findByCode(code);
    if (!discount) return { discount: null, evaluation: { ok: false, reason: 'Unknown discount code' } };
    const uses =
      discount.perCustomerLimit !== null && (input.email || input.customerId)
        ? await this.repo.customerUses(discount.code, input.email, input.customerId)
        : 0;
    return {
      discount,
      evaluation: evaluateDiscount(discount, {
        subtotalCents: input.subtotalCents,
        now: new Date(),
        customerUses: uses,
      }),
    };
  }

  async redeem(discountId: string): Promise<void> {
    if (!(await this.repo.incrementUsage(discountId))) throw new DiscountExhaustedError();
  }

  async release(discountId: string): Promise<void> {
    await this.repo.decrementUsage(discountId);
  }

  findByCode(code: string) {
    return this.repo.findByCode(code);
  }
}
