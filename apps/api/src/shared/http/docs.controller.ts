import { Controller, Get, Header } from '@nestjs/common';
import { buildOpenApi, collectControllers } from './openapi';
import { Doc } from './doc';
import { Public } from './surface';

let cached: Record<string, unknown> | null = null;
let modules: unknown[] = [];
let extra: Array<abstract new (...args: never[]) => unknown> = [];

export function registerDocumentedModules(
  list: unknown[],
  controllers: Array<abstract new (...args: never[]) => unknown>,
): void {
  modules = list;
  extra = controllers;
  cached = null;
}

@Controller()
export class DocsController {
  @Get('openapi.json')
  @Public()
  @Doc({ summary: 'OpenAPI 3.1 document', tags: ['ops'] })
  openapi() {
    cached ??= buildOpenApi([...extra, DocsController, ...collectControllers(modules)], {
      title: 'Commerce Intelligence Platform API',
      version: '1.0.0',
    });
    return cached;
  }

  @Get('docs')
  @Public()
  @Header('content-type', 'text/html; charset=utf-8')
  @Doc({ summary: 'Swagger UI', tags: ['ops'] })
  docs() {
    return `<!doctype html><html><head><meta charset="utf-8"><title>CIP API</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"></head>
<body><div id="ui"></div><script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>window.ui = SwaggerUIBundle({ url: '/openapi.json', dom_id: '#ui' });</script></body></html>`;
  }
}
