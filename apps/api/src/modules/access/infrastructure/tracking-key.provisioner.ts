import { Inject, Injectable } from '@nestjs/common';
import type { TrackingKeyProvisioner } from '../../identity';
import { ApiKeyService } from '../application/api-key.service';

@Injectable()
export class ApiKeyTrackingProvisioner implements TrackingKeyProvisioner {
  constructor(@Inject(ApiKeyService) private readonly keys: ApiKeyService) {}

  async provision(_tenantId: string, createdBy: string | null): Promise<string> {
    const { secret } = await this.keys.create('publishable', [], createdBy);
    return secret;
  }
}
