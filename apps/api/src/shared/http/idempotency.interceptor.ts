import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import type { RedisKeys } from '@cip/contracts';
import type { Request, Response } from 'express';
import type { Redis } from 'ioredis';
import { from, mergeMap, of, catchError, throwError, type Observable } from 'rxjs';
import { sha256, stableStringify } from '../crypto';
import { DomainError } from '../errors';
import { currentContext } from '../request-context';
import { KEYS, REDIS } from '../tokens';
import { IDEMPOTENT_KEY } from './surface';

export class IdempotencyKeyRequiredError extends DomainError {
  constructor() {
    super('IDEMPOTENCY_KEY_REQUIRED', 400, 'Idempotency-Key header is required for this operation');
  }
}

export class IdempotencyKeyReusedError extends DomainError {
  constructor() {
    super('IDEMPOTENCY_KEY_REUSED', 422, 'Idempotency-Key was already used with a different request body');
  }
}

export class IdempotencyInProgressError extends DomainError {
  constructor() {
    super(
      'IDEMPOTENCY_IN_PROGRESS',
      409,
      'A request with this Idempotency-Key is still being processed',
      undefined,
      {
        'Retry-After': '1',
      },
    );
  }
}

interface StoredEntry {
  state: 'in_progress' | 'done';
  hash: string;
  status?: number;
  body?: unknown;
}

const IN_PROGRESS_TTL = 60;
const DONE_TTL = 24 * 3600;

export function requestHash(method: string, path: string, body: unknown): string {
  return sha256(`${method}\n${path}\n${stableStringify(body ?? {})}`);
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(KEYS) private readonly keys: RedisKeys,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<{ required: boolean } | undefined>(
      IDEMPOTENT_KEY,
      context.getHandler(),
    );
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers['idempotency-key'];
    const key = (Array.isArray(header) ? header[0] : header)?.trim();
    if (!options) return next.handle();
    if (!key) {
      if (options.required) throw new IdempotencyKeyRequiredError();
      return next.handle();
    }
    if (!/^[\x21-\x7e]{8,255}$/.test(key)) throw new IdempotencyKeyRequiredError();
    const res = context.switchToHttp().getResponse<Response>();
    const tenantId = currentContext()?.tenantId ?? 'global';
    const redisKey = this.keys.idempotency(
      tenantId,
      sha256(`${req.method} ${req.route?.path ?? req.path} ${key}`),
    );
    const hash = requestHash(req.method, req.originalUrl.split('?')[0] ?? req.path, req.body);
    const status =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
      (req.method === 'POST' ? 201 : 200);
    return from(
      this.redis.set(
        redisKey,
        JSON.stringify({ state: 'in_progress', hash } satisfies StoredEntry),
        'EX',
        IN_PROGRESS_TTL,
        'NX',
      ),
    ).pipe(
      mergeMap((acquired) => {
        if (acquired === 'OK') {
          return next.handle().pipe(
            mergeMap((body: unknown) =>
              from(
                this.redis
                  .set(
                    redisKey,
                    JSON.stringify({ state: 'done', hash, status, body } satisfies StoredEntry),
                    'EX',
                    DONE_TTL,
                  )
                  .then(() => body),
              ),
            ),
            catchError((error: unknown) =>
              from(this.redis.del(redisKey)).pipe(mergeMap(() => throwError(() => error))),
            ),
          );
        }
        return from(this.redis.get(redisKey)).pipe(
          mergeMap((raw) => {
            if (!raw) return next.handle();
            const stored = JSON.parse(raw) as StoredEntry;
            if (stored.hash !== hash) return throwError(() => new IdempotencyKeyReusedError());
            if (stored.state === 'in_progress') return throwError(() => new IdempotencyInProgressError());
            res.setHeader('Idempotent-Replayed', 'true');
            res.status(stored.status ?? status);
            return of(stored.body);
          }),
        );
      }),
    );
  }
}
