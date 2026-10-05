export type Props = Record<string, unknown>;

export interface TrackerEvent {
  event_id: string;
  event_type: string;
  schema_version: number;
  occurred_at: string;
  anonymous_id: string;
  session_id: string;
  customer_id?: string;
  context: Props;
  properties: Props;
}

export interface TrackerEnv {
  fetch?: typeof fetch;
  beacon?: (url: string, body: string) => boolean;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  getCookie?: (name: string) => string | null;
  setCookie?: (name: string, value: string, maxAgeSeconds: number) => void;
  location?: { href: string; pathname: string; search: string };
  doc?: {
    referrer: string;
    title: string;
    visibilityState: string;
    addEventListener(type: string, cb: () => void): void;
  };
  dnt?: boolean;
  locale?: string;
  now?: () => number;
  random?: () => number;
}

export interface TrackerOptions {
  key: string;
  endpoint: string;
  flushAt?: number;
  flushInterval?: number;
  maxQueue?: number;
  consent?: boolean;
  respectDoNotTrack?: boolean;
  env?: TrackerEnv;
}

const ANON = 'cip_aid';
const SESSION = 'cip_sid';
const QUEUE = 'cip_q';
const SESSION_TTL = 1800000;

const hex = (n: number) => n.toString(16).padStart(2, '0');

export function uuidv7(now: number, random: () => number): string {
  const b: number[] = [];
  for (let i = 0; i < 16; i++) b.push(Math.floor(random() * 256));
  for (let i = 0; i < 6; i++) b[i] = Math.floor(now / 2 ** (8 * (5 - i))) & 255;
  b[6] = (b[6]! & 15) | 112;
  b[8] = (b[8]! & 63) | 128;
  const h = b.map(hex).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function browserEnv(): TrackerEnv {
  const w = typeof window === 'undefined' ? undefined : window;
  if (!w) return {};
  let storage: Storage | null;
  try {
    storage = w.localStorage;
  } catch {
    storage = null;
  }
  return {
    fetch: w.fetch.bind(w),
    beacon: (url, body) => !!w.navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain' })),
    storage,
    getCookie: (name) => new RegExp(`(?:^|; )${name}=([^;]*)`).exec(w.document.cookie)?.[1] ?? null,
    setCookie: (name, value, maxAge) => {
      w.document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; samesite=lax`;
    },
    location: w.location,
    doc: w.document,
    dnt: w.navigator.doNotTrack === '1',
    locale: w.navigator.language,
  };
}

export class Tracker {
  readonly anonymousId: string;
  private customerId: string | undefined;
  private queue: TrackerEvent[] = [];
  private consent: boolean;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sending = false;
  private failures = 0;
  private blockedUntil = 0;
  private readonly env: TrackerEnv;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(private readonly options: TrackerOptions) {
    this.env = options.env ?? browserEnv();
    this.now = this.env.now ?? Date.now;
    this.random = this.env.random ?? Math.random;
    this.consent = (options.consent ?? true) && !(options.respectDoNotTrack !== false && this.env.dnt);
    const existing = this.env.getCookie?.(ANON);
    this.anonymousId =
      existing && /^[0-9a-f-]{36}$/.test(existing) ? existing : uuidv7(this.now(), this.random);
    this.env.setCookie?.(ANON, this.anonymousId, 31536000);
    if (this.consent) this.restore();
    this.env.doc?.addEventListener('visibilitychange', () => {
      if (this.env.doc?.visibilityState === 'hidden') this.flush(true);
    });
    this.schedule();
  }

  get sessionId(): string {
    const store = this.env.storage;
    const now = this.now();
    let session: { id: string; at: number } | null;
    try {
      session = JSON.parse(store?.getItem(SESSION) ?? 'null') as { id: string; at: number } | null;
    } catch {
      session = null;
    }
    const id = session && now - session.at < SESSION_TTL ? session.id : uuidv7(now, this.random);
    store?.setItem(SESSION, JSON.stringify({ id, at: now }));
    return id;
  }

  get pending(): number {
    return this.queue.length;
  }

  setConsent(value: boolean): void {
    this.consent = value;
    if (!value) {
      this.queue = [];
      this.env.storage?.removeItem(QUEUE);
    }
  }

  identify(customerId: string | undefined): void {
    this.customerId = customerId;
  }

  page(props: Props = {}): void {
    this.track('page_viewed', { page_type: 'other', ...props });
  }

  track(type: string, properties: Props = {}): TrackerEvent | null {
    if (!this.consent) return null;
    const loc = this.env.location;
    const search = new URLSearchParams(loc?.search ?? '');
    const campaign: Props = {};
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign']) {
      const v = search.get(k);
      if (v) campaign[k] = v;
    }
    const event: TrackerEvent = {
      event_id: uuidv7(this.now(), this.random),
      event_type: type,
      schema_version: 1,
      occurred_at: new Date(this.now()).toISOString(),
      anonymous_id: this.anonymousId,
      session_id: this.sessionId,
      ...(this.customerId ? { customer_id: this.customerId } : {}),
      context: {
        ...(loc
          ? {
              page: {
                url: loc.href,
                path: loc.pathname,
                referrer: this.env.doc?.referrer || undefined,
                title: this.env.doc?.title,
              },
            }
          : {}),
        ...(this.env.locale ? { locale: this.env.locale } : {}),
        ...(Object.keys(campaign).length ? { campaign } : {}),
      },
      properties,
    };
    this.queue.push(event);
    if (this.queue.length > (this.options.maxQueue ?? 500))
      this.queue.splice(0, this.queue.length - (this.options.maxQueue ?? 500));
    this.persist();
    if (this.queue.length >= (this.options.flushAt ?? 20)) this.flush();
    return event;
  }

  flush(useBeacon = false): Promise<void> {
    if (!this.consent || this.queue.length === 0 || this.sending) return Promise.resolve();
    const batch = this.queue.slice(0, 50);
    const body = JSON.stringify({ events: batch, sent_at: new Date(this.now()).toISOString() });
    const url = `${this.options.endpoint.replace(/\/$/, '')}/v1/events`;
    if (useBeacon && this.env.beacon?.(`${url}?key=${encodeURIComponent(this.options.key)}`, body)) {
      this.remove(batch);
      return Promise.resolve();
    }
    if (!this.env.fetch || this.now() < this.blockedUntil) return Promise.resolve();
    this.sending = true;
    return this.env
      .fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.options.key },
        body,
        keepalive: true,
      })
      .then((response) => {
        if (response.status === 202 || response.status === 400) {
          this.failures = 0;
          this.remove(batch);
        } else this.backoff(Number(response.headers.get('retry-after')));
      })
      .catch(() => this.backoff(0))
      .finally(() => {
        this.sending = false;
        if (this.queue.length >= (this.options.flushAt ?? 20) && this.now() >= this.blockedUntil)
          void this.flush();
      });
  }

  private backoff(retryAfterSeconds: number): void {
    this.failures += 1;
    const exp = Math.min(60000, 1000 * 2 ** (this.failures - 1));
    const delay = retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : exp / 2 + this.random() * (exp / 2);
    this.blockedUntil = this.now() + delay;
  }

  private remove(batch: TrackerEvent[]): void {
    const ids = new Set(batch.map((e) => e.event_id));
    this.queue = this.queue.filter((e) => !ids.has(e.event_id));
    this.persist();
  }

  private persist(): void {
    try {
      if (this.queue.length) this.env.storage?.setItem(QUEUE, JSON.stringify(this.queue));
      else this.env.storage?.removeItem(QUEUE);
    } catch {
      return;
    }
  }

  private restore(): void {
    try {
      const saved = JSON.parse(this.env.storage?.getItem(QUEUE) ?? '[]') as TrackerEvent[];
      if (Array.isArray(saved)) this.queue = saved.slice(-(this.options.maxQueue ?? 500));
    } catch {
      this.queue = [];
    }
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      void this.flush().finally(() => this.schedule());
    }, this.options.flushInterval ?? 5000);
  }

  shutdown(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

export function createTracker(options: TrackerOptions): Tracker {
  return new Tracker(options);
}
