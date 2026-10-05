import { execFileSync, spawn } from 'node:child_process';
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVICES, waitHealthy } from './stack.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const PORT_KEYS = {
  api: 'api',
  collector: 'collector',
  'realtime-gateway': 'gateway',
  'stream-worker': 'stream',
  'domain-worker': 'domain',
  storefront: 'storefront',
  admin: 'admin',
};

function usage(message) {
  if (message) process.stderr.write(`stack-ctl: ${message}\n`);
  process.stderr.write(
    'usage: node scripts/stack-ctl.mjs <profile> kill|stop|start|restart|pid|status <service> [KEY=VALUE ...] [--force]\n' +
      `services: ${SERVICES.map((s) => s.name).join(', ')}\n`,
  );
  process.exit(2);
}

export function loadStack(profile) {
  const file = join(root, '.smoke', `${profile}.json`);
  if (!existsSync(file)) throw new Error(`${file} not found: is the ${profile} stack running?`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function servicePid(stack, name) {
  const port = stack.ports[PORT_KEYS[name]];
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(Number);
    return out[0] ?? null;
  } catch {
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function killService(stack, name, signal) {
  const pid = servicePid(stack, name);
  if (!pid) {
    process.stdout.write(`stack-ctl: ${name} is not running\n`);
    return null;
  }
  process.kill(pid, signal);
  const deadline = Date.now() + 15000;
  while (alive(pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  if (alive(pid)) process.kill(pid, 'SIGKILL');
  rmSync(join(stack.logDir, `${name}.pid`), { force: true });
  process.stdout.write(`stack-ctl: ${name} (pid ${pid}) stopped with ${signal}\n`);
  return pid;
}

async function startService(stack, name, extraEnv) {
  const service = SERVICES.find((s) => s.name === name);
  const existing = servicePid(stack, name);
  if (existing) throw new Error(`${name} is already running (pid ${existing})`);
  const cmd = typeof service.cmd === 'function' ? service.cmd(stack.ports) : service.cmd;
  const out = openSync(join(stack.logDir, `${name}.log`), 'a');
  const child = spawn(cmd[0], cmd.slice(1), {
    cwd: root,
    env: { ...process.env, ...(stack.passEnv ?? {}), ...stack.env, ...extraEnv },
    stdio: ['ignore', out, out],
    detached: true,
  });
  child.unref();
  writeFileSync(join(stack.logDir, `${name}.pid`), String(child.pid));
  await waitHealthy(service.health(stack.ports), 90000);
  const overrides = Object.keys(extraEnv).length
    ? ` with ${Object.entries(extraEnv)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')}`
    : '';
  process.stdout.write(`stack-ctl: ${name} started (pid ${child.pid})${overrides}\n`);
  return child.pid;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const [profile, action, name, ...rest] = args.filter((a) => a !== '--force');
  if (!profile || !action || !name) usage();
  if (!SERVICES.some((s) => s.name === name)) usage(`unknown service ${name}`);
  const extraEnv = {};
  for (const pair of rest) {
    const index = pair.indexOf('=');
    if (index <= 0) usage(`bad env override ${pair}`);
    extraEnv[pair.slice(0, index)] = pair.slice(index + 1);
  }
  const stack = loadStack(profile);
  const destructive = action === 'kill' || action === 'stop' || action === 'restart';
  if (destructive && !stack.chaos && !force)
    usage(
      `the ${profile} stack was not started with STACK_CHAOS=1, so stopping ${name} would tear it down; restart it as STACK_CHAOS=1 node scripts/stack.mjs ${profile} or pass --force`,
    );
  switch (action) {
    case 'pid':
      process.stdout.write(`${servicePid(stack, name) ?? ''}\n`);
      break;
    case 'status': {
      const pid = servicePid(stack, name);
      process.stdout.write(`${name}: ${pid ? `running (pid ${pid})` : 'stopped'}\n`);
      break;
    }
    case 'kill':
      await killService(stack, name, 'SIGKILL');
      break;
    case 'stop':
      await killService(stack, name, 'SIGTERM');
      break;
    case 'start':
      await startService(stack, name, extraEnv);
      break;
    case 'restart':
      await killService(stack, name, 'SIGTERM');
      await startService(stack, name, extraEnv);
      break;
    default:
      usage(`unknown action ${action}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`stack-ctl: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
