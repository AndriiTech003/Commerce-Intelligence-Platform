import { Inject, Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import type { Redis } from 'ioredis';
import { jwtVerify, SignJWT } from 'jose';
import type { RedisKeys } from '@cip/contracts';
import type { ApiConfig } from '../../../config';
import { RateLimitedError } from '../../../shared/errors';
import type { Mailer } from '../../../shared/infrastructure/mailer';
import { CONFIG, KEYS, MAILER, REDIS } from '../../../shared/tokens';
import type {
  AccessClaims,
  LoginThrottle,
  MailSender,
  PasswordHasher,
  TokenSigner,
} from '../application/ports';

@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  hash(password: string) {
    return hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  }

  async verify(passwordHash: string, password: string) {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }
}

@Injectable()
export class JoseTokenSigner implements TokenSigner {
  private readonly secret: Uint8Array;

  constructor(@Inject(CONFIG) private readonly config: ApiConfig) {
    this.secret = new TextEncoder().encode(config.JWT_SECRET);
  }

  async sign(claims: AccessClaims) {
    const expiresIn = this.config.ACCESS_TOKEN_TTL_SECONDS;
    const token = await new SignJWT({
      typ: claims.typ,
      ...(claims.tid ? { tid: claims.tid } : {}),
      ...(claims.pa ? { pa: true } : {}),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setIssuer('cip-api')
      .setExpirationTime(`${expiresIn}s`)
      .sign(this.secret);
    return { token, expiresIn };
  }

  async verify(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { issuer: 'cip-api', algorithms: ['HS256'] });
      if (typeof payload.sub !== 'string') return null;
      if (payload.typ !== 'staff' && payload.typ !== 'customer') return null;
      return {
        sub: payload.sub,
        typ: payload.typ,
        ...(typeof payload.tid === 'string' ? { tid: payload.tid } : {}),
        ...(payload.pa === true ? { pa: true } : {}),
      };
    } catch {
      return null;
    }
  }
}

@Injectable()
export class RedisLoginThrottle implements LoginThrottle {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(KEYS) private readonly keys: RedisKeys,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  async check(subject: string) {
    const key = this.keys.loginRateLimit(subject);
    const [attempts, ttl] = await Promise.all([this.redis.get(key), this.redis.ttl(key)]);
    if (Number(attempts ?? 0) >= this.config.LOGIN_RATE_LIMIT) throw new RateLimitedError(Math.max(1, ttl));
  }

  async fail(subject: string) {
    const key = this.keys.loginRateLimit(subject);
    const attempts = await this.redis.incr(key);
    if (attempts === 1) await this.redis.expire(key, 900);
  }

  async reset(subject: string) {
    await this.redis.del(this.keys.loginRateLimit(subject));
  }
}

@Injectable()
export class SmtpMailSender implements MailSender {
  constructor(@Inject(MAILER) private readonly mailer: Mailer) {}

  send(message: { to: string; subject: string; text: string; html?: string }) {
    return this.mailer.send(message);
  }
}
