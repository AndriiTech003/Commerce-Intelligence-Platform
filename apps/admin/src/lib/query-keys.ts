export const queryKeys = {
  me: () => ['me'] as const,
  products: {
    all: (tenantId: string | null) => ['products', tenantId] as const,
    list: (tenantId: string | null, params: Record<string, unknown>) =>
      ['products', tenantId, 'list', params] as const,
    detail: (tenantId: string | null, id: string) => ['products', tenantId, 'detail', id] as const,
  },
  categories: (tenantId: string | null) => ['categories', tenantId] as const,
  orders: {
    all: (tenantId: string | null) => ['orders', tenantId] as const,
    list: (tenantId: string | null, params: Record<string, unknown>) =>
      ['orders', tenantId, 'list', params] as const,
    detail: (tenantId: string | null, id: string) => ['orders', tenantId, 'detail', id] as const,
  },
  inventory: (tenantId: string | null, params: Record<string, unknown>) =>
    ['inventory', tenantId, params] as const,
  discounts: (tenantId: string | null) => ['discounts', tenantId] as const,
  customers: {
    list: (tenantId: string | null, params: Record<string, unknown>) =>
      ['customers', tenantId, params] as const,
    detail: (tenantId: string | null, id: string) => ['customers', tenantId, 'detail', id] as const,
    profile: (tenantId: string | null, id: string) =>
      ['customers', tenantId, 'detail', id, 'profile'] as const,
    timeline: (tenantId: string | null, id: string) =>
      ['customers', tenantId, 'detail', id, 'timeline'] as const,
  },
  profiles: {
    detail: (tenantId: string | null, id: string) => ['profiles', tenantId, id] as const,
  },
  segments: {
    all: (tenantId: string | null) => ['segments', tenantId] as const,
    list: (tenantId: string | null) => ['segments', tenantId, 'list'] as const,
    features: (tenantId: string | null) => ['segments', tenantId, 'features'] as const,
    preview: (tenantId: string | null, rules: string) => ['segments', tenantId, 'preview', rules] as const,
  },
  campaigns: {
    all: (tenantId: string | null) => ['campaigns', tenantId] as const,
    list: (tenantId: string | null) => ['campaigns', tenantId, 'list'] as const,
    detail: (tenantId: string | null, id: string) => ['campaigns', tenantId, 'detail', id] as const,
    experiment: (tenantId: string | null, id: string) => ['campaigns', tenantId, 'experiment', id] as const,
    previewProducts: (tenantId: string | null, selector: Record<string, unknown>, limit: number) =>
      ['campaigns', tenantId, 'preview-products', selector, limit] as const,
  },
  creatives: {
    reviewQueue: (tenantId: string | null) => ['creatives', tenantId, 'review-queue'] as const,
  },
  aiFeatures: (tenantId: string | null) => ['ai-features', tenantId] as const,
  jobs: {
    detail: (tenantId: string | null, id: string) => ['jobs', tenantId, id] as const,
  },
  decisions: {
    detail: (tenantId: string | null, id: string) => ['decisions', tenantId, id] as const,
  },
  webhooks: {
    all: (tenantId: string | null) => ['webhooks', tenantId] as const,
    list: (tenantId: string | null) => ['webhooks', tenantId, 'list'] as const,
    deliveries: (tenantId: string | null, id: string) => ['webhooks', tenantId, 'deliveries', id] as const,
  },
  members: (tenantId: string | null) => ['members', tenantId] as const,
  invitations: (tenantId: string | null) => ['invitations', tenantId] as const,
  apiKeys: (tenantId: string | null) => ['api-keys', tenantId] as const,
  audit: (tenantId: string | null, params: Record<string, unknown>) => ['audit', tenantId, params] as const,
  settings: (tenantId: string | null) => ['settings', tenantId] as const,
  analytics: (tenantId: string | null, name: string, params: Record<string, unknown>) =>
    ['analytics', tenantId, name, params] as const,
  platform: {
    tenants: () => ['platform', 'tenants'] as const,
    dlq: () => ['platform', 'dlq'] as const,
    dlqMessages: (queue: string) => ['platform', 'dlq', queue] as const,
    simulator: () => ['platform', 'simulator'] as const,
    groundTruth: () => ['platform', 'simulator', 'ground-truth'] as const,
  },
};
