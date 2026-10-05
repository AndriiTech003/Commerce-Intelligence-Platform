import { Controller, Get, Inject } from '@nestjs/common';
import { profileViewSchema, uuid } from '@cip/contracts';
import { Doc } from '../../../shared/http/doc';
import { Admin } from '../../../shared/http/surface';
import { ZParam } from '../../../shared/http/zod';
import { currentContext } from '../../../shared/request-context';
import { ProfileService } from '../application/profile.service';

@Controller('v1/admin/profiles')
export class ProfilesController {
  constructor(@Inject(ProfileService) private readonly profiles: ProfileService) {}

  @Get(':id')
  @Admin('customers:read')
  @Doc({
    summary: 'Personalization profile by profile id (customer id or anonymous id)',
    tags: ['personalization'],
    response: profileViewSchema,
  })
  get(@ZParam('id', uuid) id: string) {
    return this.profiles.view(currentContext()!.tenantId!, id);
  }
}
