const GRAFANA = process.env.GRAFANA_URL ?? 'http://127.0.0.1:4192';
const PROMETHEUS = process.env.PROMETHEUS_URL ?? 'http://127.0.0.1:4191';
const JAEGER = process.env.JAEGER_URL ?? 'http://127.0.0.1:4193';
const AUTH = `Basic ${Buffer.from(process.env.GRAFANA_AUTH ?? 'admin:admin').toString('base64')}`;
const EXPECTED_DASHBOARDS = [
  'cip-system-overview',
  'cip-event-pipeline',
  'cip-business',
  'cip-personalization',
];
const EXPECTED_DATASOURCES = { prometheus: 'prometheus', jaeger: 'jaeger' };
const MIN_ALERT_RULES = 8;

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
  process.stdout.write(`  FAIL ${message}\n`);
}

function pass(message) {
  process.stdout.write(`  ok   ${message}\n`);
}

function warn(message) {
  warnings.push(message);
  process.stdout.write(`  warn ${message}\n`);
}

async function get(url, { auth = false, method = 'GET', body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(auth ? { authorization: AUTH } : {}),
      ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
    signal: AbortSignal.timeout(10000),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, text };
}

function collectExprs(panels, out = []) {
  for (const panel of panels ?? []) {
    if (panel.panels) collectExprs(panel.panels, out);
    for (const t of panel.targets ?? []) if (t.expr) out.push({ panel: panel.title, expr: t.expr });
  }
  return out;
}

function substitute(expr) {
  return expr
    .replaceAll('$__range', '1h')
    .replaceAll('$__rate_interval', '1m')
    .replaceAll('$__interval', '15s')
    .replaceAll('$profile', 'dev')
    .replaceAll('$vhost', '.*');
}

async function checkGrafana() {
  process.stdout.write(`Grafana ${GRAFANA}\n`);
  const health = await get(`${GRAFANA}/api/health`).catch((e) => ({ status: 0, text: String(e) }));
  if (health.status !== 200) {
    fail(`Grafana not reachable (${health.status} ${health.text?.slice(0, 120)})`);
    return;
  }
  pass(`health: version ${health.json?.version}, database ${health.json?.database}`);

  const sources = await get(`${GRAFANA}/api/datasources`, { auth: true });
  if (sources.status !== 200) fail(`GET /api/datasources returned ${sources.status}`);
  const list = sources.json ?? [];
  process.stdout.write(
    `  datasources: ${list.map((d) => `${d.name} (${d.type}, uid=${d.uid}, ${d.url})`).join('; ')}\n`,
  );
  for (const [uid, type] of Object.entries(EXPECTED_DATASOURCES)) {
    const found = list.find((d) => d.uid === uid);
    if (!found) {
      fail(`datasource uid=${uid} is not provisioned`);
      continue;
    }
    if (found.type !== type) fail(`datasource ${uid} has type ${found.type}, expected ${type}`);
    const check = await get(`${GRAFANA}/api/datasources/uid/${uid}/health`, { auth: true });
    if (check.status === 200 && (check.json?.status ?? 'OK').toUpperCase() === 'OK')
      pass(`datasource ${found.name}: ${check.json?.message ?? 'healthy'}`);
    else
      fail(
        `datasource ${found.name} health: ${check.status} ${check.json?.message ?? check.text.slice(0, 160)}`,
      );
  }

  const search = await get(`${GRAFANA}/api/search?type=dash-db&tag=cip`, { auth: true });
  const found = new Map((search.json ?? []).map((d) => [d.uid, d]));
  for (const uid of EXPECTED_DASHBOARDS) {
    if (!found.has(uid)) {
      fail(`dashboard ${uid} not found by /api/search`);
      continue;
    }
    const dash = await get(`${GRAFANA}/api/dashboards/uid/${uid}`, { auth: true });
    if (dash.status !== 200) {
      fail(`GET /api/dashboards/uid/${uid} returned ${dash.status}`);
      continue;
    }
    const model = dash.json.dashboard;
    const exprs = collectExprs(model.panels);
    let broken = 0;
    for (const { panel, expr } of exprs) {
      const result = await get(`${PROMETHEUS}/api/v1/query`, {
        method: 'POST',
        body: new URLSearchParams({ query: substitute(expr) }).toString(),
      }).catch((e) => ({ status: 0, json: { error: String(e) } }));
      if (result.status !== 200) {
        broken += 1;
        fail(`${uid} / "${panel}": PromQL rejected by Prometheus: ${result.json?.error ?? result.status}`);
      }
    }
    const folder = dash.json.meta?.folderTitle ?? '-';
    if (broken === 0)
      pass(
        `dashboard ${uid} "${model.title}" in folder "${folder}": ${model.panels.length} panels, ${exprs.length} queries parse`,
      );
  }

  const rules = await get(`${GRAFANA}/api/v1/provisioning/alert-rules`, { auth: true });
  if (rules.status !== 200) fail(`GET /api/v1/provisioning/alert-rules returned ${rules.status}`);
  const ruleList = rules.json ?? [];
  if (ruleList.length >= MIN_ALERT_RULES)
    pass(
      `${ruleList.length} Grafana-managed alert rules provisioned: ${ruleList.map((r) => r.title).join('; ')}`,
    );
  else fail(`expected at least ${MIN_ALERT_RULES} alert rules, found ${ruleList.length}`);

  const ruler = await get(`${GRAFANA}/api/prometheus/grafana/api/v1/rules`, { auth: true });
  if (ruler.status === 200) {
    const all = (ruler.json?.data?.groups ?? []).flatMap((g) => g.rules ?? []);
    const byState = {};
    for (const r of all) byState[r.state] = (byState[r.state] ?? 0) + 1;
    const errors = all.filter((r) => r.health === 'error');
    pass(
      `alert evaluation: ${JSON.stringify(byState)}${errors.length ? `, ${errors.length} with errors` : ''}`,
    );
    for (const r of errors) warn(`rule "${r.name}" evaluation error: ${r.lastError}`);
    for (const r of all.filter((x) => x.state === 'firing'))
      process.stdout.write(`       firing: ${r.name} (${(r.alerts ?? []).length} instance(s))\n`);
  } else warn(`Grafana ruler state endpoint returned ${ruler.status}`);

  const contact = await get(`${GRAFANA}/api/v1/provisioning/contact-points`, { auth: true });
  if (contact.status === 200 && (contact.json ?? []).some((c) => c.name === 'cip-mailpit'))
    pass('contact point cip-mailpit (Mailpit SMTP 127.0.0.1:1025) provisioned');
  else warn('contact point cip-mailpit not found');
}

async function checkPrometheus() {
  process.stdout.write(`Prometheus ${PROMETHEUS}\n`);
  const ready = await get(`${PROMETHEUS}/-/ready`).catch((e) => ({ status: 0, text: String(e) }));
  if (ready.status !== 200) {
    fail(`Prometheus not ready (${ready.status})`);
    return;
  }
  pass('ready');
  const targets = await get(`${PROMETHEUS}/api/v1/targets?state=active`);
  const active = targets.json?.data?.activeTargets ?? [];
  const byJob = {};
  for (const t of active) {
    const job = t.labels.job;
    byJob[job] ??= { up: [], down: [] };
    byJob[job][t.health === 'up' ? 'up' : 'down'].push(`${t.labels.service ?? t.scrapeUrl}`);
  }
  for (const [job, { up, down }] of Object.entries(byJob))
    process.stdout.write(
      `       ${job.padEnd(10)} up ${String(up.length).padStart(2)}: ${up.join(', ') || '-'}${down.length ? ` | down ${down.length}: ${down.join(', ')}` : ''}\n`,
    );
  if (!byJob.prometheus?.up.length) fail('Prometheus does not scrape itself');
  if (!byJob.datastores?.up.length)
    fail('Datastore exporter target is down (start it with scripts/observability.sh start)');
  if (!byJob.rabbitmq?.up.length)
    fail('RabbitMQ exporter target is down (start it with scripts/observability.sh start)');
  else pass(`${active.filter((t) => t.health === 'up').length}/${active.length} targets up`);
  const appUp = active.filter((t) => t.labels.job?.startsWith('cip-') && t.health === 'up');
  if (appUp.length === 0) warn('no application targets are up (no dev/smoke/e2e stack running)');

  const rules = await get(`${PROMETHEUS}/api/v1/rules`);
  const groups = rules.json?.data?.groups ?? [];
  const all = groups.flatMap((g) => g.rules);
  const unhealthy = all.filter((r) => r.health !== 'ok' && r.health !== 'unknown');
  if (groups.length === 0) fail('no Prometheus rule groups loaded');
  else
    pass(
      `${groups.length} rule groups, ${all.filter((r) => r.type === 'recording').length} recording + ${all.filter((r) => r.type === 'alerting').length} alerting rules${unhealthy.length ? `, ${unhealthy.length} unhealthy` : ''}`,
    );
  for (const r of unhealthy) fail(`Prometheus rule ${r.name}: ${r.lastError}`);
  const alerts = await get(`${PROMETHEUS}/api/v1/alerts`);
  const firing = (alerts.json?.data?.alerts ?? []).filter((a) => a.state === 'firing');
  process.stdout.write(
    `       Prometheus alerts firing: ${firing.length ? firing.map((a) => `${a.labels.alertname}{${a.labels.queue ?? a.labels.service ?? a.labels.profile ?? ''}}`).join(', ') : 'none'}\n`,
  );
}

async function checkJaeger() {
  process.stdout.write(`Jaeger ${JAEGER}\n`);
  const services = await get(`${JAEGER}/api/v3/services`).catch((e) => ({ status: 0, text: String(e) }));
  if (services.status !== 200) {
    fail(`Jaeger query API not reachable (${services.status})`);
    return;
  }
  pass(`query API up, services with traces: ${(services.json?.services ?? []).join(', ') || 'none yet'}`);
}

await checkPrometheus();
await checkGrafana();
await checkJaeger();

process.stdout.write(
  `\nverify-observability: ${failures.length === 0 ? 'PASS' : 'FAIL'} (${failures.length} failure(s), ${warnings.length} warning(s))\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
