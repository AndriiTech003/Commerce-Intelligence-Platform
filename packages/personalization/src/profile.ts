import type { FeatureMap } from './segments';

export const HALF_LIFE_MS = 7 * 86_400_000;
export const PROFILE_TTL_SECONDS = 90 * 86_400;
export const ALIAS_TTL_SECONDS = 30 * 86_400;
export const INTENT_WINDOW_MS = 30 * 60_000;
export const PRICE_EWMA_ALPHA = 0.2;
export const RECENT_PRODUCTS = 20;

export const EVENT_WEIGHTS = {
  view: 1,
  search: 1.5,
  ad_click: 2,
  add_to_cart: 3,
  purchase: 5,
  remove_from_cart: -1,
} as const;

export const INTENT_COEFFICIENTS = {
  views: 0.15,
  cartAdds: 0.6,
  checkoutStarted: 1.2,
  repeatViews: 0.4,
  searches: 0.3,
} as const;

export type ProfileEventKind =
  | 'view'
  | 'search'
  | 'ad_click'
  | 'add_to_cart'
  | 'remove_from_cart'
  | 'checkout'
  | 'purchase'
  | 'refund'
  | 'session';

export interface ProfileItem {
  pid: string;
  cat?: string;
  brand?: string;
  price?: number;
  qty?: number;
}

export interface ProfileEvent {
  id: string;
  k: ProfileEventKind;
  t: number;
  sid?: string;
  pid?: string;
  cat?: string;
  brand?: string;
  tone?: string;
  price?: number;
  items?: ProfileItem[];
  amount?: number;
  discount?: boolean;
  cid?: string;
}

export interface ScoreStamp {
  score: number;
  ts: number;
}

export function decayedScore(stamp: ScoreStamp, at: number, halfLifeMs = HALF_LIFE_MS): number {
  return stamp.score * Math.pow(2, -Math.max(0, at - stamp.ts) / halfLifeMs);
}

export function decayAdd(
  current: ScoreStamp | null,
  weight: number,
  t: number,
  halfLifeMs = HALF_LIFE_MS,
): ScoreStamp {
  if (!current) return { score: weight, ts: t };
  if (t >= current.ts) return { score: decayedScore(current, t, halfLifeMs) + weight, ts: t };
  return { score: current.score + weight * Math.pow(2, -(current.ts - t) / halfLifeMs), ts: current.ts };
}

export function decayMerge(a: ScoreStamp, b: ScoreStamp, halfLifeMs = HALF_LIFE_MS): ScoreStamp {
  return a.ts >= b.ts ? decayAdd(a, b.score, b.ts, halfLifeMs) : decayAdd(b, a.score, a.ts, halfLifeMs);
}

export function intentScore(input: {
  views: number;
  cartAdds: number;
  checkoutStarted: number;
  repeatViews: number;
  searches: number;
}): number {
  const c = INTENT_COEFFICIENTS;
  const x =
    c.views * input.views +
    c.cartAdds * input.cartAdds +
    c.checkoutStarted * input.checkoutStarted +
    c.repeatViews * input.repeatViews +
    c.searches * input.searches;
  return 1 - Math.exp(-x);
}

export function priceBand(
  ewmaCents: number | null,
  quantiles: [number, number] | null,
): 'low' | 'mid' | 'high' | null {
  if (ewmaCents === null || !Number.isFinite(ewmaCents)) return null;
  if (!quantiles) return 'mid';
  if (ewmaCents < quantiles[0]) return 'low';
  if (ewmaCents > quantiles[1]) return 'high';
  return 'mid';
}

export function categoryLevels(path: string): string[] {
  const parts = path.split('.').filter(Boolean);
  return parts.map((_, index) => parts.slice(0, index + 1).join('.'));
}

export interface RecentProduct {
  pid: string;
  weight: number;
  ts: number;
  cat: string;
}

export interface ProfileState {
  profileId: string;
  customerId: string | null;
  categories: Record<string, ScoreStamp>;
  brands: Record<string, ScoreStamp>;
  tones: Record<string, ScoreStamp>;
  priceEwma: number | null;
  lastSeenAt: number | null;
  ordersCount: number;
  ltvCents: number;
  lastOrderAt: number | null;
  usedDiscount: boolean;
  recent: RecentProduct[];
  purchased: Record<string, number>;
  sessions: Record<string, number>;
  intentEvents: Array<{ k: string; t: number; p: string | null }>;
  recoVersion: number;
  version: number;
}

function stamp(raw: string | undefined): ScoreStamp | null {
  if (!raw) return null;
  const sep = raw.indexOf('|');
  if (sep < 0) return null;
  const score = Number(raw.slice(0, sep));
  const ts = Number(raw.slice(sep + 1));
  return Number.isFinite(score) && Number.isFinite(ts) ? { score, ts } : null;
}

function json<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function num(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function emptyProfile(profileId: string): ProfileState {
  return {
    profileId,
    customerId: null,
    categories: {},
    brands: {},
    tones: {},
    priceEwma: null,
    lastSeenAt: null,
    ordersCount: 0,
    ltvCents: 0,
    lastOrderAt: null,
    usedDiscount: false,
    recent: [],
    purchased: {},
    sessions: {},
    intentEvents: [],
    recoVersion: 0,
    version: 0,
  };
}

export function parseProfileHash(profileId: string, hash: Record<string, string>): ProfileState {
  const state = emptyProfile(hash.pid ?? profileId);
  for (const [field, value] of Object.entries(hash)) {
    if (field.startsWith('a:cat:')) {
      const s = stamp(value);
      if (s) state.categories[field.slice(6)] = s;
    } else if (field.startsWith('a:brand:')) {
      const s = stamp(value);
      if (s) state.brands[field.slice(8)] = s;
    } else if (field.startsWith('a:tone:')) {
      const s = stamp(value);
      if (s) state.tones[field.slice(7)] = s;
    }
  }
  state.customerId = hash.cid ?? null;
  state.priceEwma = num(hash.pe);
  state.lastSeenAt = num(hash.ls);
  state.ordersCount = num(hash.oc) ?? 0;
  state.ltvCents = num(hash.ltv) ?? 0;
  state.lastOrderAt = num(hash.lo);
  state.usedDiscount = hash.ud === '1';
  const recent = json<unknown>(hash.rp, []);
  state.recent = Array.isArray(recent)
    ? recent
        .filter((r): r is [string, number, number, string] => Array.isArray(r) && typeof r[0] === 'string')
        .map((r) => ({ pid: r[0], weight: Number(r[1]), ts: Number(r[2]), cat: String(r[3] ?? '') }))
    : [];
  const purchased = json<unknown>(hash.pp, {});
  state.purchased = purchased && !Array.isArray(purchased) ? (purchased as Record<string, number>) : {};
  const sessions = json<unknown>(hash.ss, {});
  state.sessions = sessions && !Array.isArray(sessions) ? (sessions as Record<string, number>) : {};
  const intent = json<unknown>(hash.ie, []);
  state.intentEvents = Array.isArray(intent)
    ? intent
        .filter((r): r is [string, number, string] => Array.isArray(r))
        .map((r) => ({ k: String(r[0]), t: Number(r[1]), p: typeof r[2] === 'string' && r[2] ? r[2] : null }))
    : [];
  state.recoVersion = num(hash.rv) ?? 0;
  state.version = num(hash.v) ?? 0;
  return state;
}

export function isEmptyProfile(state: ProfileState): boolean {
  return state.version === 0 && Object.keys(state.categories).length === 0 && state.ordersCount === 0;
}

export function decayedMap(map: Record<string, ScoreStamp>, now: number, halfLifeMs = HALF_LIFE_MS) {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(map))
    out[key] = Math.max(0, decayedScore(value, now, halfLifeMs));
  return out;
}

export function intentFromState(state: ProfileState, now: number): number {
  const recent = state.intentEvents.filter((e) => e.t >= now - INTENT_WINDOW_MS && e.t <= now + 60_000);
  const viewed = new Map<string, number>();
  let views = 0;
  let cartAdds = 0;
  let checkoutStarted = 0;
  let searches = 0;
  for (const event of recent) {
    if (event.k === 'v') {
      views += 1;
      if (event.p) viewed.set(event.p, (viewed.get(event.p) ?? 0) + 1);
    } else if (event.k === 'c') cartAdds += 1;
    else if (event.k === 'o') checkoutStarted += 1;
    else if (event.k === 's') searches += 1;
  }
  let repeatViews = 0;
  for (const count of viewed.values()) if (count > 1) repeatViews += count - 1;
  return intentScore({ views, cartAdds, checkoutStarted, repeatViews, searches });
}

export function topCategories(
  state: ProfileState,
  now: number,
  limit = 3,
  options: { level?: number } = {},
): Array<{ path: string; score: number }> {
  const scores = decayedMap(state.categories, now);
  return Object.entries(scores)
    .filter(([path, score]) => score > 0 && (!options.level || path.split('.').length === options.level))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([path, score]) => ({ path, score }));
}

export function topLevelCategory(state: ProfileState, now: number): string | null {
  return topCategories(state, now, 1, { level: 1 })[0]?.path ?? null;
}

export type PriceQuantiles = Record<string, [number, number]>;

export function profileFeatures(
  state: ProfileState,
  options: { now?: number; quantiles?: PriceQuantiles } = {},
): FeatureMap {
  const now = options.now ?? Date.now();
  const features: FeatureMap = {};
  for (const [path, score] of Object.entries(decayedMap(state.categories, now)))
    features[`aff.cat.${path}`] = round(score);
  for (const [brand, score] of Object.entries(decayedMap(state.brands, now)))
    features[`aff.brand.${brand}`] = round(score);
  for (const [tone, score] of Object.entries(decayedMap(state.tones, now)))
    features[`aff.tone.${tone}`] = round(score);
  const top = topLevelCategory(state, now);
  const quantiles =
    top && options.quantiles ? (options.quantiles[top] ?? options.quantiles._all ?? null) : null;
  features['price.ewma_cents'] = state.priceEwma === null ? null : Math.round(state.priceEwma);
  features['price.band'] = priceBand(state.priceEwma, quantiles ?? options.quantiles?._all ?? null);
  features.intent = round(intentFromState(state, now));
  features.sessions_30d = Object.values(state.sessions).filter((t) => t >= now - 30 * 86_400_000).length;
  features.orders_count = state.ordersCount;
  features.ltv_cents = state.ltvCents;
  features.used_discount = state.usedDiscount;
  features.last_seen_at = state.lastSeenAt === null ? null : new Date(state.lastSeenAt).toISOString();
  features.last_order_at = state.lastOrderAt === null ? null : new Date(state.lastOrderAt).toISOString();
  features.days_since_last_order =
    state.lastOrderAt === null ? null : round((now - state.lastOrderAt) / 86_400_000);
  features.days_since_last_seen =
    state.lastSeenAt === null ? null : round((now - state.lastSeenAt) / 86_400_000);
  return features;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function profileVectorWeights(
  state: ProfileState,
  now: number,
  limit = 10,
): Array<{ pid: string; weight: number }> {
  return [...state.recent]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit)
    .map((r) => ({
      pid: r.pid,
      weight: Math.max(0, r.weight) * Math.pow(2, -Math.max(0, now - r.ts) / HALF_LIFE_MS),
    }))
    .filter((r) => r.weight > 0);
}

export function weightedAverageVector(items: Array<{ vector: number[]; weight: number }>): number[] | null {
  const valid = items.filter((i) => i.vector.length > 0 && i.weight > 0);
  if (valid.length === 0) return null;
  const dims = valid[0]!.vector.length;
  const out = new Array<number>(dims).fill(0);
  for (const item of valid) for (let i = 0; i < dims; i++) out[i]! += (item.vector[i] ?? 0) * item.weight;
  const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0));
  return norm > 0 ? out.map((v) => v / norm) : null;
}

export function profileSignals(
  state: ProfileState,
  options: {
    now?: number;
    formatPrice?: (cents: number) => string;
    categoryName?: (path: string) => string;
  } = {},
): string[] {
  const now = options.now ?? Date.now();
  const format = options.formatPrice ?? ((cents: number) => `$${Math.round(cents / 100)}`);
  const name = options.categoryName ?? ((path: string) => path.split('.').pop()!.replace(/_/g, ' '));
  const signals: string[] = [];
  const day = state.recent.filter((r) => r.ts >= now - 86_400_000);
  if (day.length > 0) {
    const counts = new Map<string, number>();
    for (const r of day) {
      const top = r.cat.split('.')[0] ?? '';
      if (top) counts.set(top, (counts.get(top) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best)
      signals.push(`Viewed ${best[1]} ${name(best[0])} product${best[1] === 1 ? '' : 's'} in the last 24h`);
    else signals.push(`Viewed ${day.length} product${day.length === 1 ? '' : 's'} in the last 24h`);
  }
  const top = topCategories(state, now, 1)[0];
  if (top) signals.push(`Strongest interest: ${name(top.path)} (affinity ${top.score.toFixed(1)})`);
  if (state.ordersCount > 0 && state.lastOrderAt !== null) {
    const days = Math.max(0, Math.round((now - state.lastOrderAt) / 86_400_000));
    signals.push(
      `Placed ${state.ordersCount} order${state.ordersCount === 1 ? '' : 's'}, the last one ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}`,
    );
  }
  if (state.priceEwma !== null)
    signals.push(`Typical price range ${format(state.priceEwma * 0.75)}–${format(state.priceEwma * 1.25)}`);
  const intent = intentFromState(state, now);
  if (intent >= 0.5) signals.push(`High purchase intent right now (${intent.toFixed(2)})`);
  if (state.usedDiscount) signals.push('Has bought with a discount code before');
  return signals;
}

export const PROFILE_UPDATE_LUA = `
local key = KEYS[1]
local dirty = KEYS[2]
local tenants = KEYS[3]
local events = cjson.decode(ARGV[1])
local hl = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local dedupPrefix = ARGV[4]
local keyPrefix = ARGV[5]
local profileId = ARGV[6]
local tenantId = ARGV[7]
local now = tonumber(ARGV[8])
local dedupTtl = tonumber(ARGV[9])
local alias = redis.call('HGET', key, 'alias')
if alias then
  key = keyPrefix .. alias
  profileId = alias
end
local function parse(raw)
  if not raw then return nil end
  local sep = string.find(raw, '|', 1, true)
  if not sep then return nil end
  return tonumber(string.sub(raw, 1, sep - 1)), tonumber(string.sub(raw, sep + 1))
end
local function bump(field, w, t)
  local s, ts = parse(redis.call('HGET', key, field))
  if not s then
    s = w
    ts = t
  elseif t >= ts then
    s = s * math.pow(2, -(t - ts) / hl) + w
    ts = t
  else
    s = s + w * math.pow(2, -(ts - t) / hl)
  end
  redis.call('HSET', key, field, string.format('%.6f|%.0f', s, ts))
end
local function cats(path, w, t)
  if not path or path == '' then return end
  local acc = ''
  for part in string.gmatch(path, '[^%.]+') do
    if acc == '' then acc = part else acc = acc .. '.' .. part end
    bump('a:cat:' .. acc, w, t)
  end
end
local function brand(name, w, t)
  if name and name ~= '' then bump('a:brand:' .. name, w, t) end
end
local function jget(field, default)
  local raw = redis.call('HGET', key, field)
  if raw then
    local ok, value = pcall(cjson.decode, raw)
    if ok and type(value) == 'table' then return value end
  end
  return default
end
local function jset(field, value, isArray)
  if isArray and #value == 0 then
    redis.call('HSET', key, field, '[]')
  else
    redis.call('HSET', key, field, cjson.encode(value))
  end
end
local function price(p)
  if not p or p <= 0 then return end
  local current = tonumber(redis.call('HGET', key, 'pe'))
  if current then
    redis.call('HSET', key, 'pe', string.format('%.4f', current * 0.8 + p * 0.2))
  else
    redis.call('HSET', key, 'pe', string.format('%.4f', p))
  end
end
local recent = nil
local function remember(pid, w, t, cat)
  if not pid or pid == '' then return end
  if not recent then recent = jget('rp', {}) end
  for _, r in ipairs(recent) do
    if r[1] == pid then
      if t >= r[3] then
        r[2] = r[2] * math.pow(2, -(t - r[3]) / hl) + w
        r[3] = t
      else
        r[2] = r[2] + w * math.pow(2, -(r[3] - t) / hl)
      end
      if cat and cat ~= '' then r[4] = cat end
      return
    end
  end
  table.insert(recent, { pid, w, t, cat or '' })
end
local intent = nil
local function intentEvent(k, t, pid)
  if not intent then intent = jget('ie', {}) end
  table.insert(intent, { k, t, pid or '' })
end
local sessions = nil
local function session(sid, t)
  if not sid or sid == '' then return end
  if not sessions then sessions = jget('ss', {}) end
  local current = sessions[sid]
  if not current or t > current then sessions[sid] = t end
end
local purchased = nil
local applied = 0
local maxT = tonumber(redis.call('HGET', key, 'ls')) or 0
local reco = false
for _, e in ipairs(events) do
  local fresh = true
  if e.id and e.id ~= '' then
    fresh = redis.call('SET', dedupPrefix .. e.id, '1', 'NX', 'EX', dedupTtl)
  end
  if fresh then
    applied = applied + 1
    local t = tonumber(e.t)
    if t > maxT then maxT = t end
    session(e.sid, t)
    if e.cid and e.cid ~= '' then redis.call('HSET', key, 'cid', e.cid) end
    if e.k == 'view' then
      cats(e.cat, 1, t)
      brand(e.brand, 1, t)
      price(e.price)
      remember(e.pid, 1, t, e.cat)
      intentEvent('v', t, e.pid)
    elseif e.k == 'search' then
      cats(e.cat, 1.5, t)
      intentEvent('s', t, nil)
    elseif e.k == 'ad_click' then
      cats(e.cat, 2, t)
      if e.tone and e.tone ~= '' then bump('a:tone:' .. e.tone, 1, t) end
    elseif e.k == 'add_to_cart' then
      cats(e.cat, 3, t)
      brand(e.brand, 3, t)
      price(e.price)
      remember(e.pid, 3, t, e.cat)
      intentEvent('c', t, e.pid)
      reco = true
    elseif e.k == 'remove_from_cart' then
      cats(e.cat, -1, t)
      brand(e.brand, -1, t)
    elseif e.k == 'checkout' then
      intentEvent('o', t, nil)
      reco = true
    elseif e.k == 'purchase' then
      if not purchased then purchased = jget('pp', {}) end
      for _, item in ipairs(e.items or {}) do
        cats(item.cat, 5, t)
        brand(item.brand, 5, t)
        price(item.price)
        remember(item.pid, 5, t, item.cat)
        local seen = purchased[item.pid]
        if not seen or t > seen then purchased[item.pid] = t end
      end
      redis.call('HINCRBY', key, 'oc', 1)
      redis.call('HINCRBYFLOAT', key, 'ltv', tonumber(e.amount) or 0)
      local lo = tonumber(redis.call('HGET', key, 'lo')) or 0
      if t > lo then redis.call('HSET', key, 'lo', string.format('%.0f', t)) end
      if e.discount then redis.call('HSET', key, 'ud', '1') end
      reco = true
    elseif e.k == 'refund' then
      redis.call('HINCRBYFLOAT', key, 'ltv', -(tonumber(e.amount) or 0))
    end
  end
end
if applied == 0 then return 0 end
if recent then
  table.sort(recent, function(a, b) return a[3] > b[3] end)
  while #recent > 20 do table.remove(recent) end
  jset('rp', recent, true)
end
if intent then
  local kept = {}
  for _, r in ipairs(intent) do
    if r[2] >= now - 1800000 then table.insert(kept, r) end
  end
  table.sort(kept, function(a, b) return a[2] > b[2] end)
  while #kept > 100 do table.remove(kept) end
  jset('ie', kept, true)
end
if sessions then
  local kept = {}
  local count = 0
  for sid, ts in pairs(sessions) do
    if ts >= now - 2592000000 then
      kept[sid] = ts
      count = count + 1
    end
  end
  if count == 0 then redis.call('HSET', key, 'ss', '{}') else jset('ss', kept, false) end
end
if purchased then
  local kept = {}
  local count = 0
  for pid, ts in pairs(purchased) do
    if ts >= now - 7776000000 then
      kept[pid] = ts
      count = count + 1
    end
  end
  if count == 0 then redis.call('HSET', key, 'pp', '{}') else jset('pp', kept, false) end
end
redis.call('HSET', key, 'ls', string.format('%.0f', maxT), 'pid', profileId)
redis.call('HINCRBY', key, 'v', 1)
if reco then redis.call('HINCRBY', key, 'rv', 1) end
redis.call('EXPIRE', key, ttl)
redis.call('SADD', dirty, profileId)
redis.call('EXPIRE', dirty, 86400)
redis.call('SADD', tenants, tenantId)
redis.call('EXPIRE', tenants, 86400)
return applied
`;

export const PROFILE_MERGE_LUA = `
local anon = KEYS[1]
local target = KEYS[2]
local dirty = KEYS[3]
local tenants = KEYS[4]
local hl = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local aliasTtl = tonumber(ARGV[3])
local customerId = ARGV[4]
local tenantId = ARGV[5]
if anon == target then return 0 end
local existing = redis.call('HGET', anon, 'alias')
if existing then
  redis.call('EXPIRE', anon, aliasTtl)
  return 0
end
local src = redis.call('HGETALL', anon)
local function parse(raw)
  if not raw then return nil end
  local sep = string.find(raw, '|', 1, true)
  if not sep then return nil end
  return tonumber(string.sub(raw, 1, sep - 1)), tonumber(string.sub(raw, sep + 1))
end
local function decode(raw, default)
  if not raw then return default end
  local ok, value = pcall(cjson.decode, raw)
  if ok and type(value) == 'table' then return value end
  return default
end
local merged = 0
for i = 1, #src, 2 do
  local field = src[i]
  local value = src[i + 1]
  if string.sub(field, 1, 2) == 'a:' then
    local s1, t1 = parse(value)
    local s2, t2 = parse(redis.call('HGET', target, field))
    if s1 then
      if not s2 then
        redis.call('HSET', target, field, value)
      elseif t1 >= t2 then
        redis.call('HSET', target, field, string.format('%.6f|%.0f', s1 + s2 * math.pow(2, -(t1 - t2) / hl), t1))
      else
        redis.call('HSET', target, field, string.format('%.6f|%.0f', s2 + s1 * math.pow(2, -(t2 - t1) / hl), t2))
      end
    end
  elseif field == 'oc' or field == 'ltv' then
    redis.call('HINCRBYFLOAT', target, field, tonumber(value) or 0)
  elseif field == 'ls' or field == 'lo' then
    local current = tonumber(redis.call('HGET', target, field)) or 0
    if (tonumber(value) or 0) > current then redis.call('HSET', target, field, value) end
  elseif field == 'ud' then
    if value == '1' then redis.call('HSET', target, 'ud', '1') end
  elseif field == 'pe' then
    if redis.call('HEXISTS', target, 'pe') == 0 then redis.call('HSET', target, 'pe', value) end
  elseif field == 'rp' or field == 'ie' then
    local a = decode(value, {})
    local b = decode(redis.call('HGET', target, field), {})
    local index = field == 'rp' and 3 or 2
    local limit = field == 'rp' and 20 or 100
    for _, r in ipairs(a) do table.insert(b, r) end
    table.sort(b, function(x, y) return x[index] > y[index] end)
    local out = {}
    local seen = {}
    for _, r in ipairs(b) do
      local id = field == 'rp' and r[1] or (r[1] .. ':' .. tostring(r[2]) .. ':' .. tostring(r[3]))
      if not seen[id] and #out < limit then
        seen[id] = true
        table.insert(out, r)
      end
    end
    if #out == 0 then redis.call('HSET', target, field, '[]') else redis.call('HSET', target, field, cjson.encode(out)) end
  elseif field == 'pp' or field == 'ss' then
    local a = decode(value, {})
    local b = decode(redis.call('HGET', target, field), {})
    local count = 0
    for k, ts in pairs(a) do
      if not b[k] or ts > b[k] then b[k] = ts end
    end
    for _ in pairs(b) do count = count + 1 end
    if count == 0 then redis.call('HSET', target, field, '{}') else redis.call('HSET', target, field, cjson.encode(b)) end
  end
  merged = merged + 1
end
redis.call('HSET', target, 'cid', customerId, 'pid', customerId)
redis.call('HINCRBY', target, 'v', 1)
redis.call('HINCRBY', target, 'rv', 1)
redis.call('EXPIRE', target, ttl)
redis.call('DEL', anon)
redis.call('HSET', anon, 'alias', customerId)
redis.call('EXPIRE', anon, aliasTtl)
redis.call('SADD', dirty, customerId)
redis.call('EXPIRE', dirty, 86400)
redis.call('SADD', tenants, tenantId)
redis.call('EXPIRE', tenants, 86400)
return merged
`;
