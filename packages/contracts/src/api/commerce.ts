import { z } from 'zod';
import { uuid } from '../events/envelope';
import { ORDER_STATUSES } from '../order-state';
import { SHIPPING_METHODS } from '../shipping';

export const orderStatusSchema = z.enum(ORDER_STATUSES);

export const cartItemInputSchema = z.object({ variantId: uuid, quantity: z.number().int().min(1).max(99) });
export const cartItemUpdateSchema = z.object({ quantity: z.number().int().min(1).max(99) });
export const cartDiscountSchema = z.object({ code: z.string().trim().min(1).max(64) });

export const cartLineSchema = z.object({
  variantId: uuid,
  productId: uuid,
  productTitle: z.string(),
  productSlug: z.string(),
  variantTitle: z.string(),
  sku: z.string(),
  imageUrl: z.string().nullable(),
  categoryPath: z.string().nullable(),
  quantity: z.number().int(),
  unitPriceCents: z.number().int(),
  previousUnitPriceCents: z.number().int().nullable(),
  priceChanged: z.boolean(),
  lineTotalCents: z.number().int(),
  available: z.number().int(),
});

export const cartSchema = z.object({
  id: uuid.nullable(),
  currency: z.string(),
  items: z.array(cartLineSchema),
  itemsCount: z.number().int(),
  subtotalCents: z.number().int(),
  discountCode: z.string().nullable(),
  discountCents: z.number().int(),
  discountError: z.string().nullable(),
  totalCents: z.number().int(),
});

export const addressSchema = z.object({
  name: z.string().trim().min(1).max(120),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(120),
  postalCode: z.string().trim().min(1).max(20),
  country: z.string().trim().length(2).toUpperCase(),
});

export const checkoutSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  shippingAddress: addressSchema,
  shippingMethod: z.enum(SHIPPING_METHODS),
  discountCode: z.string().trim().max(64).nullish(),
});

export const paymentIntentSchema = z.object({
  provider: z.string(),
  intentId: z.string(),
  clientSecret: z.string(),
});

export const checkoutResponseSchema = z.object({
  orderId: uuid,
  number: z.number().int(),
  status: orderStatusSchema,
  totalCents: z.number().int(),
  currency: z.string(),
  payment: paymentIntentSchema,
});

export const orderItemSchema = z.object({
  id: uuid,
  variantId: uuid,
  productId: uuid,
  title: z.string(),
  sku: z.string(),
  unitPriceCents: z.number().int(),
  quantity: z.number().int(),
});

export const orderHistorySchema = z.object({
  id: uuid,
  fromStatus: z.string().nullable(),
  toStatus: z.string(),
  reason: z.string().nullable(),
  actorId: z.string().nullable(),
  createdAt: z.string(),
});

export const paymentSchema = z.object({
  id: uuid,
  provider: z.string(),
  providerRef: z.string(),
  status: z.string(),
  amountCents: z.number().int(),
  createdAt: z.string(),
});

export const orderSummarySchema = z.object({
  id: uuid,
  number: z.number().int(),
  email: z.string(),
  customerId: z.string().nullable(),
  status: orderStatusSchema,
  currency: z.string(),
  totalCents: z.number().int(),
  itemsCount: z.number().int(),
  placedAt: z.string(),
});

export const orderDetailSchema = orderSummarySchema.extend({
  subtotalCents: z.number().int(),
  discountCents: z.number().int(),
  shippingCents: z.number().int(),
  discountCode: z.string().nullable(),
  shippingAddress: z.record(z.string(), z.unknown()),
  attribution: z.record(z.string(), z.unknown()).nullable(),
  items: z.array(orderItemSchema),
  history: z.array(orderHistorySchema),
  payments: z.array(paymentSchema),
  allowedTransitions: z.array(orderStatusSchema),
  refundable: z.boolean(),
});

export const publicOrderSchema = z.object({
  id: uuid,
  number: z.number().int(),
  status: orderStatusSchema,
  currency: z.string(),
  subtotalCents: z.number().int(),
  discountCents: z.number().int(),
  shippingCents: z.number().int(),
  totalCents: z.number().int(),
  email: z.string(),
  placedAt: z.string(),
  items: z.array(orderItemSchema),
  payment: paymentIntentSchema.nullable(),
});

export const orderListQuerySchema = z.object({
  status: orderStatusSchema.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  customerId: uuid.optional(),
  email: z.string().max(254).optional(),
  number: z.coerce.number().int().optional(),
  minTotal: z.coerce.number().int().optional(),
  maxTotal: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export const orderTransitionSchema = z.object({
  to: orderStatusSchema,
  note: z.string().max(500).optional(),
});

export const refundSchema = z.object({ reason: z.string().max(500).optional() });

export const DISCOUNT_TYPES = ['percent', 'fixed'] as const;

const discountBase = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
  type: z.enum(DISCOUNT_TYPES),
  value: z.number().int().min(1),
  minSubtotalCents: z.number().int().min(0).default(0),
  startsAt: z.iso.datetime({ offset: true }).nullish(),
  endsAt: z.iso.datetime({ offset: true }).nullish(),
  usageLimit: z.number().int().min(1).nullish(),
  perCustomerLimit: z.number().int().min(1).nullish(),
  active: z.boolean().default(true),
});

export const discountCreateSchema = discountBase.refine((d) => d.type !== 'percent' || d.value <= 100, {
  message: 'percent discount must be between 1 and 100',
  path: ['value'],
});

export const discountUpdateSchema = discountBase.partial();

export const discountSchema = z.object({
  id: uuid,
  code: z.string(),
  type: z.enum(DISCOUNT_TYPES),
  value: z.number().int(),
  minSubtotalCents: z.number().int(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  usageLimit: z.number().int().nullable(),
  perCustomerLimit: z.number().int().nullable(),
  usedCount: z.number().int(),
  active: z.boolean(),
});

export const customerListItemSchema = z.object({
  id: uuid,
  email: z.string(),
  name: z.string().nullable(),
  registered: z.boolean(),
  ordersCount: z.number().int(),
  ltvCents: z.number().int(),
  createdAt: z.string(),
});

export const fakeConfirmSchema = z.object({ cardNumber: z.string().trim().min(12).max(23) });

export const storeInfoSchema = z.object({
  id: uuid,
  slug: z.string(),
  name: z.string(),
  currency: z.string(),
  brandColor: z.string(),
  tagline: z.string(),
  trackingKey: z.string().nullable(),
  collectorUrl: z.string(),
  paymentProvider: z.string(),
  shippingMethods: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      cents: z.number().int(),
      freeOverCents: z.number().int().nullable(),
    }),
  ),
});
