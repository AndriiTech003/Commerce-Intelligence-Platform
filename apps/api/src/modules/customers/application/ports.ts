export const CUSTOMER_QUERIES = Symbol('CUSTOMER_QUERIES');

export interface CustomerSummaryRow {
  id: string;
  email: string;
  name: string | null;
  registered: boolean;
  ordersCount: number;
  ltvCents: number;
  createdAt: Date;
  anonymousIds: string[];
}

export interface CustomerQueries {
  list(query: {
    q?: string | undefined;
    limit: number;
    cursor: string | null;
  }): Promise<CustomerSummaryRow[]>;
  find(id: string): Promise<CustomerSummaryRow | null>;
  profile(
    id: string,
  ): Promise<{ features: Record<string, unknown>; segments: string[]; updatedAt: Date } | null>;
}
