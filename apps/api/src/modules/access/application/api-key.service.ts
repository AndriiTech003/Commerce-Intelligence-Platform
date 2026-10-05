import { Inject, Injectable } from '@nestjs/common';
import { uuidv7, type Permission } from '@cip/contracts';
import { sha256 } from '../../../shared/crypto';
import { NotFoundError } from '../../../shared/errors';
import { currentContext } from '../../../shared/request-context';
import { UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import { generateApiKey, kindOfKey, type ApiKeyKind, type ApiKeyRecord } from '../domain/api-key';
import { API_KEY_CACHE, API_KEY_REPOSITORY, type ApiKeyCache, type ApiKeyRepository } from './ports';

@Injectable()
export class ApiKeyService {
  constructor(
    @Inject(API_KEY_REPOSITORY) private readonly keys: ApiKeyRepository,
    @Inject(API_KEY_CACHE) private readonly cache: ApiKeyCache,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  async create(kind: ApiKeyKind, scopes: Permission[], createdBy: string | null) {
    const { raw, prefix } = generateApiKey(kind);
    const record = await this.uow.run(() =>
      this.keys.create({
        id: uuidv7(),
        kind,
        prefix,
        keyHash: sha256(raw),
        scopes: kind === 'publishable' ? [] : scopes,
        createdBy,
      }),
    );
    return { record, secret: raw };
  }

  list() {
    return this.uow.run(() => this.keys.list());
  }

  async revoke(id: string) {
    const revoked = await this.uow.run(() => this.keys.revoke(id));
    if (!revoked) throw new NotFoundError('API key', id);
    await this.cache.invalidate(revoked.keyHash);
  }

  async authenticate(raw: string, kind: ApiKeyKind): Promise<ApiKeyRecord | null> {
    if (kindOfKey(raw) !== kind) return null;
    const hash = sha256(raw);
    const cached = await this.cache.get(hash);
    let record = cached === undefined ? null : cached;
    if (cached === undefined) {
      record = await this.keys.findActiveByHash(hash);
      await this.cache.set(hash, record);
    }
    if (!record || record.revokedAt) return null;
    void this.keys.touch(record.id).catch(() => undefined);
    return record;
  }

  view(record: ApiKeyRecord) {
    return {
      id: record.id,
      kind: record.kind,
      prefix: record.prefix,
      scopes: record.scopes,
      createdAt: record.createdAt.toISOString(),
      lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
      revokedAt: record.revokedAt?.toISOString() ?? null,
    };
  }

  currentActorId(): string | null {
    const actor = currentContext()?.actor;
    return actor?.type === 'user' ? actor.id : null;
  }
}
