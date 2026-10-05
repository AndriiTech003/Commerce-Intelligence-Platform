import { Controller, Delete, Get, HttpCode, Inject, Patch, Post } from '@nestjs/common';
import {
  segmentCreateSchema,
  segmentFeaturesSchema,
  segmentPreviewRequestSchema,
  segmentPreviewSchema,
  segmentSchema,
  segmentUpdateSchema,
  uuid,
} from '@cip/contracts';
import { z } from 'zod';
import { Doc } from '../../../shared/http/doc';
import { Admin, Audit } from '../../../shared/http/surface';
import { ZBody, ZParam } from '../../../shared/http/zod';
import { currentContext } from '../../../shared/request-context';
import { SegmentService } from '../application/segment.service';
import { ProfileSnapshotService } from '../application/snapshot.service';

export const LIVE_FLUSH_MAX_PROFILES = 5000;

function tenant(): string {
  return currentContext()!.tenantId!;
}

@Controller('v1/admin/segments')
export class SegmentsController {
  constructor(
    @Inject(SegmentService) private readonly segments: SegmentService,
    @Inject(ProfileSnapshotService) private readonly snapshots: ProfileSnapshotService,
  ) {}

  private async flushLiveProfiles(): Promise<void> {
    await this.snapshots.flushTenant(tenant(), 500, LIVE_FLUSH_MAX_PROFILES);
  }

  @Get()
  @Admin('customers:read')
  @Doc({
    summary:
      'Segments with rules and member counts (live profiles changed since the last snapshot are flushed first)',
    tags: ['personalization'],
    response: z.object({ data: z.array(segmentSchema) }),
  })
  async list() {
    await this.flushLiveProfiles();
    return this.segments.list();
  }

  @Get('features')
  @Admin('customers:read')
  @Doc({
    summary: 'Features, categories and brands available to the rule builder',
    tags: ['personalization'],
    response: segmentFeaturesSchema,
  })
  features() {
    return this.segments.features();
  }

  @Post()
  @Admin('marketing:write')
  @Audit('segment.created', 'segment')
  @Doc({
    summary: 'Create a segment (rules are validated and compiled)',
    tags: ['personalization'],
    body: segmentCreateSchema,
    response: segmentSchema,
    status: 201,
  })
  async create(@ZBody(segmentCreateSchema) body: z.infer<typeof segmentCreateSchema>) {
    const created = await this.segments.create(tenant(), body);
    currentContext()?.audit.push({ entityId: created.id, before: null, after: { ...created } });
    return created;
  }

  @Post('preview')
  @Admin('customers:read')
  @HttpCode(200)
  @Doc({
    summary:
      'How many profiles match the rules (live profiles changed since the last snapshot are flushed first)',
    tags: ['personalization'],
    body: segmentPreviewRequestSchema,
    response: segmentPreviewSchema,
  })
  async preview(@ZBody(segmentPreviewRequestSchema) body: z.infer<typeof segmentPreviewRequestSchema>) {
    await this.flushLiveProfiles();
    return this.segments.preview(body.rules);
  }

  @Patch(':id')
  @Admin('marketing:write')
  @Audit('segment.updated', 'segment')
  @Doc({
    summary: 'Update a segment',
    tags: ['personalization'],
    body: segmentUpdateSchema,
    response: segmentSchema,
  })
  async update(
    @ZParam('id', uuid) id: string,
    @ZBody(segmentUpdateSchema) body: z.infer<typeof segmentUpdateSchema>,
  ) {
    const { before, after } = await this.segments.update(tenant(), id, body);
    currentContext()?.audit.push({ entityId: id, before: { ...before }, after: { ...after } });
    return after;
  }

  @Delete(':id')
  @Admin('marketing:write')
  @Audit('segment.deleted', 'segment')
  @HttpCode(204)
  @Doc({ summary: 'Delete a custom segment', tags: ['personalization'], status: 204 })
  async remove(@ZParam('id', uuid) id: string) {
    const before = await this.segments.remove(tenant(), id);
    currentContext()?.audit.push({ entityId: id, before: { ...before }, after: null });
  }
}
