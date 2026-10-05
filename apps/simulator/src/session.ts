import { uuidv7 } from '@cip/contracts';
import { counter } from '@cip/observability';
import {
  armProbabilities,
  clickProbability,
  pickProduct,
  planSession,
  type ArmTruth,
  type CatalogProduct,
  type Random,
} from './behaviour';
import type { DecisionResponse, StoreClient, Visitor } from './client';
import type { Persona } from './personas';

const sessionsTotal = counter('simulator_sessions_total', 'Simulated sessions', ['store', 'persona']);
const eventsSent = counter('simulator_events_sent_total', 'Events sent to the collector', ['store']);
const decisionsTotal = counter('simulator_decisions_total', 'Decisions requested', ['store', 'policy']);
const clicksTotal = counter('simulator_ad_clicks_total', 'Simulated ad clicks', ['store', 'persona']);
const ordersTotal = counter('simulator_orders_total', 'Orders placed by the simulator', ['store', 'outcome']);

const AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
];
const COUNTRIES = ['US', 'DE', 'GB', 'FR', 'NL', 'PL', 'ES'];

export interface SessionObserver {
  decision(
    persona: Persona,
    decision: DecisionResponse,
    clicked: boolean,
    probabilities: Record<string, number> | null,
    warm: boolean,
  ): void;
  order(ok: boolean): void;
  session(persona: Persona): void;
  error(error: unknown): void;
}

export interface SessionOptions {
  rand: Random;
  delay: (ms: number) => Promise<void>;
  pageDelayMs: [number, number];
  shifted: Record<string, Record<string, number>>;
  arms: (decision: DecisionResponse, visitor: Visitor) => Promise<ArmTruth[]>;
  observer?: SessionObserver | undefined;
  discountCode?: string;
}

export class SessionRunner {
  constructor(private readonly client: StoreClient) {}

  async run(visitor: Visitor, persona: Persona, options: SessionOptions): Promise<void> {
    const { rand } = options;
    const plan = planSession(persona, rand);
    const sessionId = uuidv7();
    const agent = AGENTS[Math.floor(rand() * AGENTS.length)]!;
    const country = COUNTRIES[Math.floor(rand() * COUNTRIES.length)]!;
    const queue: Array<Record<string, unknown>> = [];
    visitor.sessions += 1;
    sessionsTotal.inc({ store: this.client.slug, persona: persona.key });
    options.observer?.session(persona);
    const track = (type: string, path: string, properties: Record<string, unknown>) => {
      queue.push({
        event_id: uuidv7(),
        event_type: type,
        schema_version: 1,
        occurred_at: new Date().toISOString(),
        anonymous_id: visitor.anonymousId,
        ...(visitor.customerId ? { customer_id: visitor.customerId } : {}),
        session_id: sessionId,
        context: {
          page: { url: `http://${this.client.slug}.localhost${path}`, path },
          user_agent: agent,
          locale: 'en-US',
          country,
        },
        properties,
      });
    };
    const flush = async () => {
      const batch = queue.splice(0, queue.length);
      if (batch.length > 0) eventsSent.inc({ store: this.client.slug }, await this.client.send(batch));
    };
    const pause = () =>
      options.delay(options.pageDelayMs[0] + rand() * (options.pageDelayMs[1] - options.pageDelayMs[0]));
    const view = (product: CatalogProduct) =>
      track('product_viewed', `/p/${product.slug}`, {
        product_id: product.id,
        category_path: product.categoryPath ?? '',
        price_cents: product.priceMinCents ?? 0,
        title: product.title,
        ...(product.brand ? { brand: product.brand } : {}),
      });
    const decide = async (placement: string, warm: boolean, productId?: string) => {
      await flush();
      const decision = await this.client.decision(visitor, placement, productId);
      if (!decision) return null;
      decisionsTotal.inc({ store: this.client.slug, policy: decision.policy });
      const props = {
        decision_id: decision.decisionId,
        campaign_id: decision.campaignId,
        creative_id: decision.creativeId,
        placement: decision.placement,
        segment_key: decision.segmentKey,
        policy: decision.policy,
        ...(decision.creative.tone ? { tone: decision.creative.tone } : {}),
      };
      track('ad_impression', placement === 'home_hero' ? '/' : '/p', props);
      const probability = clickProbability(
        persona,
        decision.creative.tone,
        decision.products,
        options.shifted,
      );
      const clicked = rand() < probability;
      let probabilities: Record<string, number> | null = null;
      if (decision.policy !== 'holdout_uniform') {
        const arms = await options.arms(decision, visitor).catch(() => []);
        if (arms.length > 0)
          probabilities = armProbabilities(arms, persona, decision.products, options.shifted);
      }
      options.observer?.decision(persona, decision, clicked, probabilities, warm);
      if (clicked) {
        clicksTotal.inc({ store: this.client.slug, persona: persona.key });
        track('ad_clicked', '/', { ...props, category_path: decision.products[0]?.categoryPath ?? '' });
        await flush();
        const first = decision.products[0];
        if (first) {
          const product = this.client.products.find((p) => p.id === first.id);
          if (product) view(product);
        }
      }
      return decision;
    };

    track('page_viewed', plan.landing === 'home' ? '/' : plan.landing === 'category' ? '/c' : '/p', {
      page_type: plan.landing,
    });
    if (plan.landing === 'home') await decide('home_hero', visitor.sessions > 1);
    let last: CatalogProduct | null = null;
    for (let i = 0; i < plan.views; i++) {
      const product = pickProduct(this.client.products, persona, rand);
      if (!product) break;
      view(product);
      last = product;
      if (i === Math.floor(plan.views / 2)) await flush();
      await pause();
    }
    if (plan.revisitHome) {
      await flush();
      await options.delay(400);
      track('page_viewed', '/', { page_type: 'home' });
      await decide('home_hero', true);
      await pause();
    }
    if (plan.addToCart && last) await this.purchase(visitor, last, plan, track, flush, options);
    await flush();
  }

  private async purchase(
    visitor: Visitor,
    product: CatalogProduct,
    plan: ReturnType<typeof planSession>,
    track: (type: string, path: string, properties: Record<string, unknown>) => void,
    flush: () => Promise<void>,
    options: SessionOptions,
  ): Promise<void> {
    const detail = await this.client.detail(product.slug);
    const variant = detail?.variants.find((v) => v.available > 0);
    if (!variant) return;
    const added = await this.client.addToCart(visitor, variant.id);
    if (added.status !== 200) return;
    track('cart_item_added', `/p/${product.slug}`, {
      product_id: product.id,
      variant_id: variant.id,
      quantity: 1,
      price_cents: variant.priceCents,
      category_path: product.categoryPath ?? '',
      title: product.title,
      ...(product.brand ? { brand: product.brand } : {}),
    });
    if (!plan.checkout) return;
    track('checkout_started', '/checkout', {
      cart_id: uuidv7(),
      value_cents: variant.priceCents,
      items_count: 1,
    });
    await flush();
    if (plan.useDiscount) await this.client.applyDiscount(visitor, options.discountCode ?? 'WELCOME10');
    const email =
      visitor.email ?? `sim-${visitor.anonymousId.slice(0, 8)}-${Date.now().toString(36)}@sim.cip.dev`;
    const order = await this.client.checkout(visitor, email, `sim-${uuidv7()}`);
    if (order.status !== 201) {
      ordersTotal.inc({ store: this.client.slug, outcome: String(order.status) });
      options.observer?.order(false);
      return;
    }
    ordersTotal.inc({ store: this.client.slug, outcome: 'placed' });
    options.observer?.order(true);
    if (plan.purchase) await this.client.confirm(visitor, order.body.payment.intentId);
    if (plan.register && !visitor.token) {
      const registered = await this.client.register(visitor, email);
      if (registered.status === 201 || registered.status === 200) {
        visitor.token = registered.body.accessToken;
        visitor.customerId = registered.body.customer.id;
        visitor.email = email;
      }
    }
  }
}
