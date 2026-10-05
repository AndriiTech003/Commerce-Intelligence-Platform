export { DiscountsModule } from './discounts.module';
export { DiscountService } from './application/discount.service';
export {
  DiscountInvalidError,
  evaluateDiscount,
  type Discount,
  type DiscountEvaluation,
} from './domain/discount';
