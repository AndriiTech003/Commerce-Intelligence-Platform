import type { Discount } from '../domain/discount';

export const DISCOUNT_REPOSITORY = Symbol('DISCOUNT_REPOSITORY');

export type DiscountWrite = Omit<Discount, 'id' | 'usedCount'>;

export interface DiscountRepository {
  list(): Promise<Discount[]>;
  find(id: string): Promise<Discount | null>;
  findByCode(code: string): Promise<Discount | null>;
  insert(id: string, discount: DiscountWrite): Promise<Discount>;
  update(id: string, patch: Partial<DiscountWrite>): Promise<Discount | null>;
  remove(id: string): Promise<boolean>;
  incrementUsage(id: string): Promise<boolean>;
  decrementUsage(id: string): Promise<void>;
  customerUses(code: string, email: string | null, customerId: string | null): Promise<number>;
}
