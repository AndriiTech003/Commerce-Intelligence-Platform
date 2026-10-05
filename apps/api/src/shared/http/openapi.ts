import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { problemSchema } from '@cip/contracts';
import { z, type ZodType } from 'zod';
import { DOC_KEY, type RouteDoc } from './doc';
import { SURFACE_KEY, type SurfaceMeta } from './surface';

type Json = Record<string, unknown>;
type Ctor = abstract new (...args: never[]) => unknown;

const METHODS: Record<number, string> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

export interface RouteInfo {
  method: string;
  path: string;
  doc: RouteDoc | undefined;
  surface: SurfaceMeta | undefined;
  controller: string;
  handler: string;
}

function joinPath(...parts: Array<string | undefined>): string {
  const joined = parts
    .filter((p): p is string => typeof p === 'string' && p.length > 0 && p !== '/')
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .join('/');
  return `/${joined}`;
}

export function collectControllers(modules: unknown[]): Ctor[] {
  const out: Ctor[] = [];
  for (const mod of modules) {
    const controllers = (Reflect.getMetadata('controllers', mod as object) as Ctor[] | undefined) ?? [];
    out.push(...controllers);
  }
  return out;
}

export function collectRoutes(controllers: Ctor[]): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const controller of controllers) {
    const base = Reflect.getMetadata(PATH_METADATA, controller) as string | undefined;
    const proto = controller.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      const fn = proto[name];
      if (typeof fn !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, fn) as number | undefined;
      const path = Reflect.getMetadata(PATH_METADATA, fn) as string | undefined;
      if (method === undefined || path === undefined) continue;
      routes.push({
        method: METHODS[method] ?? 'get',
        path: joinPath(base, path),
        doc: Reflect.getMetadata(DOC_KEY, fn) as RouteDoc | undefined,
        surface: (Reflect.getMetadata(SURFACE_KEY, fn) ?? Reflect.getMetadata(SURFACE_KEY, controller)) as
          SurfaceMeta | undefined,
        controller: controller.name,
        handler: name,
      });
    }
  }
  return routes.sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
  );
}

function schemaOf(schema: ZodType, io: 'input' | 'output'): Json {
  const json = z.toJSONSchema(schema, { io, unrepresentable: 'any', reused: 'inline' }) as Json;
  delete json.$schema;
  return json;
}

function queryParams(schema: ZodType | undefined): Json[] {
  if (!schema) return [];
  const json = schemaOf(schema, 'input');
  const properties = (json.properties as Record<string, Json> | undefined) ?? {};
  const required = new Set((json.required as string[] | undefined) ?? []);
  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: 'query',
    required: required.has(name) && property.default === undefined,
    schema: property,
  }));
}

function operationId(route: RouteInfo): string {
  return `${route.controller.replace(/Controller$/, '')}_${route.handler}`;
}

export function buildOpenApi(controllers: Ctor[], info: { title: string; version: string }): Json {
  const paths: Record<string, Record<string, Json>> = {};
  for (const route of collectRoutes(controllers)) {
    const openPath = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const params = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    const doc = route.doc;
    const kind = route.surface?.kind ?? 'staff';
    const headers: Json[] = (doc?.headers ?? []).map((h) => ({
      name: h.name,
      in: 'header',
      required: h.required,
      description: h.description,
      schema: { type: 'string' },
    }));
    if (kind === 'admin')
      headers.push({
        name: 'X-Tenant-Id',
        in: 'header',
        required: false,
        description: 'Store id (required with a staff JWT)',
        schema: { type: 'string' },
      });
    if (kind === 'storefront')
      headers.push({
        name: 'X-Store',
        in: 'header',
        required: false,
        description: 'Store slug when not resolved from the host',
        schema: { type: 'string' },
      });
    const status = String(doc?.status ?? (route.method === 'post' ? 201 : 200));
    const responses: Record<string, Json> = {};
    responses[status] =
      status === '204'
        ? { description: 'No content' }
        : {
            description: 'Success',
            content: {
              'application/json': { schema: doc?.response ? schemaOf(doc.response, 'output') : {} },
            },
          };
    responses.default = {
      description: 'Problem Details (RFC 9457)',
      content: { 'application/problem+json': { schema: schemaOf(problemSchema, 'output') } },
    };
    const operation: Json = {
      operationId: operationId(route),
      summary: doc?.summary ?? '',
      tags: doc?.tags ?? ['untagged'],
      parameters: [...params, ...queryParams(doc?.query), ...headers],
      responses,
      ...(kind === 'public'
        ? { security: [] }
        : kind === 'storefront'
          ? { security: [{}, { customerJwt: [] }] }
          : {}),
    };
    if (doc?.body) {
      operation.requestBody = {
        required: true,
        content: { 'application/json': { schema: schemaOf(doc.body, 'input') } },
      };
    }
    paths[openPath] = { ...(paths[openPath] ?? {}), [route.method]: operation };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: info.title,
      version: info.version,
      description: 'Commerce Intelligence Platform API (generated from zod schemas).',
    },
    servers: [{ url: 'http://127.0.0.1:4100' }],
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', description: 'Staff JWT or sk_live_ secret key' },
        customerJwt: { type: 'http', scheme: 'bearer', description: 'Customer JWT (storefront)' },
      },
    },
    security: [{ bearer: [] }],
    paths,
  };
}
