export function pgErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === 'string') return direct;
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object' && typeof (cause as { code?: unknown }).code === 'string') {
    return (cause as { code: string }).code;
  }
  return undefined;
}

export function pgConstraint(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const target = ((error as { cause?: unknown }).cause ?? error) as { constraint?: unknown };
  return typeof target.constraint === 'string' ? target.constraint : undefined;
}
