import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '@cip/contracts';
import type { ApiConfig } from '../../../config';
import { randomToken, sha256 } from '../../../shared/crypto';
import { CONFIG } from '../../../shared/tokens';
import { UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import {
  decideRefresh,
  InvalidRefreshTokenError,
  RefreshTokenReusedError,
  type RefreshTokenRecord,
} from '../domain/identity';
import {
  REFRESH_TOKEN_REPOSITORY,
  TOKEN_SIGNER,
  type AccessClaims,
  type RefreshTokenRepository,
  type TokenSigner,
} from './ports';

export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly tokens: RefreshTokenRepository,
    @Inject(TOKEN_SIGNER) private readonly signer: TokenSigner,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  private refreshRecord(
    subject: { id: string; type: 'user' | 'customer'; tenantId: string | null },
    familyId: string,
  ) {
    const raw = randomToken(32);
    const record: RefreshTokenRecord & { tokenHash: string } = {
      id: uuidv7(),
      subjectId: subject.id,
      subjectType: subject.type,
      tenantId: subject.tenantId,
      familyId,
      expiresAt: new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * 86400_000),
      revokedAt: null,
      replacedBy: null,
      tokenHash: sha256(raw),
    };
    return { raw, record };
  }

  private claimsFor(subject: {
    id: string;
    type: 'user' | 'customer';
    tenantId: string | null;
    isPlatformAdmin?: boolean;
  }): AccessClaims {
    return subject.type === 'user'
      ? { sub: subject.id, typ: 'staff', ...(subject.isPlatformAdmin ? { pa: true } : {}) }
      : { sub: subject.id, typ: 'customer', ...(subject.tenantId ? { tid: subject.tenantId } : {}) };
  }

  async issue(subject: {
    id: string;
    type: 'user' | 'customer';
    tenantId: string | null;
    isPlatformAdmin?: boolean;
  }): Promise<IssuedSession> {
    const { raw, record } = this.refreshRecord(subject, uuidv7());
    await this.tokens.create(record);
    const access = await this.signer.sign(this.claimsFor(subject));
    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: raw,
      refreshExpiresAt: record.expiresAt,
    };
  }

  async rotate(
    rawToken: string | undefined,
    expectedType: 'user' | 'customer',
    resolveExtras: (subjectId: string) => Promise<{ isPlatformAdmin?: boolean }> = async () => ({}),
  ): Promise<IssuedSession & { subjectId: string; tenantId: string | null }> {
    if (!rawToken) throw new InvalidRefreshTokenError();
    const existing = await this.tokens.findByHash(sha256(rawToken));
    if (!existing || existing.subjectType !== expectedType) throw new InvalidRefreshTokenError();
    const decision = decideRefresh(existing, new Date());
    if (decision.kind === 'reuse') {
      await this.tokens.revokeFamily(existing.familyId);
      throw new RefreshTokenReusedError();
    }
    if (decision.kind === 'expired') throw new InvalidRefreshTokenError();
    const { raw, record } = this.refreshRecord(
      { id: existing.subjectId, type: existing.subjectType, tenantId: existing.tenantId },
      existing.familyId,
    );
    const rotated = await this.uow.runSystem(() => this.tokens.rotate(existing.id, record));
    if (!rotated) {
      await this.tokens.revokeFamily(existing.familyId);
      throw new RefreshTokenReusedError();
    }
    const extras = await resolveExtras(existing.subjectId);
    const access = await this.signer.sign(
      this.claimsFor({
        id: existing.subjectId,
        type: existing.subjectType,
        tenantId: existing.tenantId,
        ...extras,
      }),
    );
    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: raw,
      refreshExpiresAt: record.expiresAt,
      subjectId: existing.subjectId,
      tenantId: existing.tenantId,
    };
  }

  async revoke(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const existing = await this.tokens.findByHash(sha256(rawToken));
    if (existing) await this.tokens.revokeFamily(existing.familyId);
  }

  verify(token: string): Promise<AccessClaims | null> {
    return this.signer.verify(token);
  }
}
