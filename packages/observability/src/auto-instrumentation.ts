import { createRequire, register as registerAsyncHooks } from 'node:module';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';

export const AUTO_INSTRUMENTED_MODULES = ['pg', 'pg-pool', 'ioredis'] as const;

interface SyncHooks {
  register(options: { include: string[] }): void;
  supportsSyncHooks(): boolean;
}

let enabled = false;

export function autoInstrumentationEnabled(): boolean {
  return enabled;
}

export function enableAutoInstrumentation(): void {
  if (enabled) return;
  enabled = true;
  const hooks = createRequire(import.meta.url)('import-in-the-middle/register-hooks.mjs') as SyncHooks;
  if (hooks.supportsSyncHooks()) hooks.register({ include: [...AUTO_INSTRUMENTED_MODULES] });
  else registerAsyncHooks('import-in-the-middle/hook.mjs', import.meta.url);
  registerInstrumentations({
    instrumentations: [
      new PgInstrumentation({
        requireParentSpan: true,
        enhancedDatabaseReporting: false,
        ignoreConnectSpans: false,
      }),
      new IORedisInstrumentation({ requireParentSpan: true }),
    ],
  });
}
