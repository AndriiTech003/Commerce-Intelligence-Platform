import { SetMetadata } from '@nestjs/common';
import type { ZodType } from 'zod';

export type Surface = 'public' | 'staff' | 'admin' | 'storefront' | 'platform' | 'webhook';

export interface RouteDoc {
  summary: string;
  tags: string[];
  body?: ZodType;
  query?: ZodType;
  response?: ZodType;
  status?: number;
  headers?: Array<{ name: string; required: boolean; description: string }>;
}

export const DOC_KEY = 'cip:doc';
export const Doc = (doc: RouteDoc) => SetMetadata(DOC_KEY, doc);
