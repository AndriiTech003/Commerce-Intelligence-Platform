export function redisKeys(prefix = '') {
  return {
    idempotency: (tenantId: string, key: string) => `${prefix}idem:${tenantId}:${key}`,
    dedup: (consumer: string, eventId: string) => `${prefix}dedup:${consumer}:${eventId}`,
    rateLimit: (subject: string, window: number | string) => `${prefix}rl:${subject}:${window}`,
    loginRateLimit: (subject: string) => `${prefix}rl:login:${subject}`,
    eventsPerSecond: (tenantId: string, epochSec: number) => `${prefix}rt:${tenantId}:ev:${epochSec}`,
    active: (tenantId: string, epochMin: number) => `${prefix}rt:${tenantId}:active:${epochMin}`,
    revenue: (tenantId: string, day: string) => `${prefix}rt:${tenantId}:revenue:${day}`,
    ordersToday: (tenantId: string, day: string) => `${prefix}rt:${tenantId}:orders:${day}`,
    feed: (tenantId: string) => `${prefix}rt:${tenantId}:feed`,
    tickChannel: (tenantId: string) => `${prefix}rt:${tenantId}:tick`,
    eventsChannel: (tenantId: string) => `${prefix}rt:${tenantId}:events`,
    tickPattern: () => `${prefix}rt:*:tick`,
    eventsPattern: () => `${prefix}rt:*:events`,
    tickGuard: (tenantId: string, epochSec: number) => `${prefix}rt:${tenantId}:tickguard:${epochSec}`,
    activeTenants: () => `${prefix}rt:tenants`,
    apiKey: (hash: string) => `${prefix}apikey:${hash}`,
    lock: (name: string) => `${prefix}lock:${name}`,
    wsTicket: (ticket: string) => `${prefix}wst:${ticket}`,
    analyticsCache: (tenantId: string, hash: string) => `${prefix}ach:${tenantId}:${hash}`,
    profile: (tenantId: string, profileId: string) => `${prefix}profile:${tenantId}:${profileId}`,
    profilePrefix: (tenantId: string) => `${prefix}profile:${tenantId}:`,
    profileDirty: (tenantId: string) => `${prefix}profile:dirty:${tenantId}`,
    profileDirtyTenants: () => `${prefix}profile:dirty:tenants`,
    profileDedupPrefix: () => `${prefix}dedup:profile:`,
    banditState: (campaignId: string, segment: string) => `${prefix}bandit:${campaignId}:${segment}`,
    banditStatePattern: () => `${prefix}bandit:*`,
    banditImpression: (decisionId: string) => `${prefix}bandit:imp:${decisionId}`,
    banditClick: (decisionId: string) => `${prefix}bandit:clk:${decisionId}`,
    banditConversion: (orderId: string) => `${prefix}bandit:conv:${orderId}`,
    decision: (decisionId: string) => `${prefix}decision:${decisionId}`,
    attribution: (tenantId: string, profileId: string) => `${prefix}attr:${tenantId}:${profileId}`,
    recoResult: (tenantId: string, profileId: string, type: string, extra: string) =>
      `${prefix}reco:res:${tenantId}:${profileId}:${type}:${extra}`,
    recoPopular: (tenantId: string, category: string) => `${prefix}reco:popular:${tenantId}:${category}`,
    recoCooc: (tenantId: string, productId: string) => `${prefix}reco:cooc:${tenantId}:${productId}`,
    recoSession: (tenantId: string, sessionId: string) => `${prefix}reco:sess:${tenantId}:${sessionId}`,
    recoViews: (tenantId: string) => `${prefix}reco:views7d:${tenantId}`,
    priceQuantiles: (tenantId: string) => `${prefix}reco:pq:${tenantId}`,
    segmentsVersion: (tenantId: string) => `${prefix}seg:ver:${tenantId}`,
    campaignsVersion: (tenantId: string) => `${prefix}camp:ver:${tenantId}`,
    llmCache: (hash: string) => `${prefix}llm:cache:${hash}`,
    llmQuota: (tenantId: string, day: string) => `${prefix}llm:quota:${tenantId}:${day}`,
    insights: (tenantId: string) => `${prefix}insights:${tenantId}`,
    simTruth: () => `${prefix}sim:truth`,
    simRegret: () => `${prefix}sim:regret`,
    simShift: () => `${prefix}sim:shift`,
    simState: () => `${prefix}sim:state`,
    notifications: (tenantId: string) => `${prefix}notif:${tenantId}`,
  };
}

export type RedisKeys = ReturnType<typeof redisKeys>;

export function utcDay(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}
