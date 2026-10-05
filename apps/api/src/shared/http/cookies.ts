import type { Request, Response } from 'express';

export const STAFF_REFRESH_COOKIE = 'cip_rt';
export const CUSTOMER_REFRESH_COOKIE = 'cip_crt';

export function readCookie(req: Request, name: string): string | undefined {
  const value = (req.cookies as Record<string, string> | undefined)?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function setRefreshCookie(
  res: Response,
  name: string,
  token: string,
  expires: Date,
  secure: boolean,
): void {
  res.cookie(name, token, { httpOnly: true, sameSite: 'lax', secure, path: '/', expires });
}

export function clearRefreshCookie(res: Response, name: string, secure: boolean): void {
  res.clearCookie(name, { httpOnly: true, sameSite: 'lax', secure, path: '/' });
}
