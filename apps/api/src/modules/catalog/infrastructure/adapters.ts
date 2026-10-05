import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from '@cip/observability';
import type { ApiConfig } from '../../../config';
import type { ObjectStorage } from '../../../shared/infrastructure/storage';
import { CONFIG, LOGGER, STORAGE } from '../../../shared/tokens';
import type { ImageStorage, StorefrontRevalidator } from '../application/ports';

@Injectable()
export class S3ImageStorage implements ImageStorage {
  constructor(@Inject(STORAGE) private readonly storage: ObjectStorage) {}

  keyFor(tenantId: string, productId: string, imageId: string, filename: string): string {
    const ext = (/\.([a-z0-9]{1,5})$/i.exec(filename)?.[1] ?? 'bin').toLowerCase();
    return this.storage.key('products', tenantId, productId, `${imageId}.${ext}`);
  }

  presignPut(key: string, contentType: string, expiresIn: number) {
    return this.storage.presignPut(key, contentType, expiresIn);
  }

  publicUrl(key: string) {
    return this.storage.publicUrl(key);
  }

  delete(key: string) {
    return this.storage.delete(key);
  }
}

@Injectable()
export class HttpStorefrontRevalidator implements StorefrontRevalidator {
  constructor(
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  revalidate(tags: string[]): void {
    const url = this.config.STOREFRONT_REVALIDATE_URL;
    if (!url || tags.length === 0) return;
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-revalidate-secret': this.config.REVALIDATE_SECRET },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(3000),
    }).catch((error: unknown) => this.logger.debug({ err: error }, 'storefront revalidation failed'));
  }
}
