import http from 'k6/http';
import { check } from 'k6';
import { API_URL, TREND_STATS, env, loadProducts, num, storefrontHeaders, summarize, uuid } from './lib.js';

const RATE = num('RATE', 50);
const DURATION = env('DURATION', '1m');
const TERMS = ['run', 'trail', 'shoe', 'jack', 'sock', 'gel', 'bottle', 'cap', 'short', 'vest'];

export const options = {
  summaryTrendStats: TREND_STATS,
  setupTimeout: '60s',
  scenarios: {
    browse: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: num('PRE_VUS', 20),
      maxVUs: num('MAX_VUS', 300),
    },
  },
  thresholds: {
    'http_req_duration{scenario:browse}': ['p(95)<200'],
    'http_req_failed{scenario:browse}': ['rate<0.001'],
    'http_req_duration{name:catalog list}': ['p(95)<200'],
    'http_req_duration{name:product}': ['p(95)<200'],
    'http_req_duration{name:search suggest}': ['p(95)<200'],
    'http_req_duration{name:recommendations}': ['p(95)<200'],
  },
};

export function setup() {
  return { products: loadProducts(num('PRODUCTS', 96)) };
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export default function (ctx) {
  const headers = storefrontHeaders(uuid());
  const roll = Math.random();
  const product = pick(ctx.products);
  let res;
  if (roll < 0.3) {
    res = http.get(`${API_URL}/v1/storefront/catalog/products?limit=24`, {
      headers,
      tags: { name: 'catalog list' },
    });
  } else if (roll < 0.6) {
    res = http.get(`${API_URL}/v1/storefront/catalog/products/${product.slug}`, {
      headers,
      tags: { name: 'product' },
    });
  } else if (roll < 0.75) {
    const term = pick(TERMS).slice(0, 2 + Math.floor(Math.random() * 3));
    res = http.get(`${API_URL}/v1/storefront/search/suggest?q=${term}`, {
      headers,
      tags: { name: 'search suggest' },
    });
  } else {
    const type = pick(['for_you', 'similar', 'bought_together']);
    const query = type === 'for_you' ? 'type=for_you' : `type=${type}&productId=${product.id}`;
    res = http.get(`${API_URL}/v1/storefront/recommendations?${query}&limit=8`, {
      headers,
      tags: { name: 'recommendations', reco_type: type },
    });
  }
  check(res, { 'status 200': (r) => r.status === 200 });
}

export function handleSummary(data) {
  const route = (name) => {
    const v = data.metrics[`http_req_duration{name:${name}}`]?.values ?? {};
    return { p50: v.med, p95: v['p(95)'], p99: v['p(99)'] };
  };
  return summarize(
    'storefront-browse',
    data,
    {
      routesMs: {
        catalogList: route('catalog list'),
        product: route('product'),
        searchSuggest: route('search suggest'),
        recommendations: route('recommendations'),
      },
    },
    'browse',
  );
}
