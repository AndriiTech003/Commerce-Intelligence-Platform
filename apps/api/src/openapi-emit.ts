import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURE_MODULES } from './app.module';
import { DocsController } from './shared/http/docs.controller';
import { HealthController } from './shared/http/health.controller';
import { buildOpenApi, collectControllers } from './shared/http/openapi';

export function generateOpenApi() {
  return buildOpenApi([HealthController, DocsController, ...collectControllers(FEATURE_MODULES)], {
    title: 'Commerce Intelligence Platform API',
    version: '1.0.0',
  });
}

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] ?? resolve(here, '../../../packages/api-client/openapi.json');
if (process.argv[1] && process.argv[1].includes('openapi-emit')) {
  writeFileSync(target, `${JSON.stringify(generateOpenApi(), null, 2)}\n`);
  console.log(`openapi: wrote ${target}`);
}
