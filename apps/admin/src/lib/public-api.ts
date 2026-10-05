export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as {
    detail?: string;
    title?: string;
    errors?: Array<{ path?: string; message?: string }>;
  };
  if (!response.ok) {
    const first = data.errors?.[0];
    throw new Error(
      first?.message
        ? `${first.path ?? ''} ${first.message}`.trim()
        : (data.detail ?? data.title ?? 'Request failed'),
    );
  }
  return data as T;
}
