import { revalidateTag } from 'next/cache';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const MAX_TAGS = 64;

export async function POST(request: NextRequest): Promise<Response> {
  const secret = process.env.REVALIDATE_SECRET ?? 'dev-revalidate-secret';
  if (request.headers.get('x-revalidate-secret') !== secret) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const tags =
    payload && typeof payload === 'object' && Array.isArray((payload as { tags?: unknown }).tags)
      ? (payload as { tags: unknown[] }).tags.filter(
          (tag): tag is string => typeof tag === 'string' && tag.length > 0 && tag.length <= 256,
        )
      : null;
  if (!tags || tags.length === 0 || tags.length > MAX_TAGS) {
    return Response.json({ error: 'tags must be a non-empty array of strings' }, { status: 400 });
  }
  for (const tag of tags) revalidateTag(tag);
  return Response.json({ revalidated: true, tags, now: Date.now() });
}
