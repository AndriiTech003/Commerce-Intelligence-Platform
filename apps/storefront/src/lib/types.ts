import type { paths } from '@cip/api-client';

type JsonOf<T> = T extends { content: { 'application/json': infer R } } ? R : never;
type Ok<Op> = Op extends { responses: infer R }
  ? R extends { 200: infer A }
    ? JsonOf<A>
    : R extends { 201: infer B }
      ? JsonOf<B>
      : R extends { 202: infer C }
        ? JsonOf<C>
        : never
  : never;

export type StoreInfo = Ok<paths['/v1/storefront/store']['get']>;
export type CategoryList = Ok<paths['/v1/storefront/catalog/categories']['get']>;
export type Category = CategoryList['data'][number];
export type ProductList = Ok<paths['/v1/storefront/catalog/products']['get']>;
export type ProductSummary = ProductList['data'][number];
export type ProductDetail = Ok<paths['/v1/storefront/catalog/products/{slug}']['get']>;
export type ProductVariant = ProductDetail['variants'][number];
export type Cart = Ok<paths['/v1/storefront/cart']['get']>;
export type CartItem = Cart['items'][number];
export type CheckoutBody = NonNullable<
  paths['/v1/storefront/checkout']['post']['requestBody']
>['content']['application/json'];
export type CheckoutResult = Ok<paths['/v1/storefront/checkout']['post']>;
export type PublicOrder = Ok<paths['/v1/storefront/orders/{id}']['get']>;
export type AccountOrders = Ok<paths['/v1/storefront/account/orders']['get']>;
export type AccountOrder = AccountOrders['data'][number];
export type Suggestions = Ok<paths['/v1/storefront/search/suggest']['get']>;

export interface Customer {
  id: string;
  email: string;
  name: string | null;
}

export interface AuthSession {
  accessToken: string;
  expiresIn: number;
  customer: Customer;
}

export type Recommendations = Ok<paths['/v1/storefront/recommendations']['get']>;
export type RecommendationType = Recommendations['type'];
export type RecommendationItem = Recommendations['items'][number];
export type Contributions = RecommendationItem['contributions'];
export type Decision = Ok<paths['/v1/storefront/decisions']['get']>;
export type DecisionProduct = Decision['products'][number];
export type Placement = Decision['placement'];
export type DecisionExplanation = Ok<paths['/v1/storefront/decisions/{id}/explanation']['get']>;
