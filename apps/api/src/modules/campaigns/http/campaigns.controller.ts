import { Controller, Get, HttpCode, Inject, Patch, Post } from '@nestjs/common';
import {
  campaignCreateSchema,
  campaignDetailSchema,
  campaignSchema,
  campaignUpdateSchema,
  creativeInputSchema,
  creativeSchema,
  generateCreativesSchema,
  generateResponseSchema,
  productPreviewSchema,
  productSelectorSchema,
  uuid,
} from '@cip/contracts';
import { z } from 'zod';
import { Doc } from '../../../shared/http/doc';
import { Admin, Audit } from '../../../shared/http/surface';
import { ZBody, ZParam } from '../../../shared/http/zod';
import { currentContext } from '../../../shared/request-context';
import { CampaignService } from '../application/campaign.service';
import { CreativeService } from '../application/creative.service';

const previewBody = z.object({
  productSelector: productSelectorSchema,
  limit: z.number().int().min(1).max(48).default(12),
});

@Controller('v1/admin/campaigns')
export class CampaignsController {
  constructor(
    @Inject(CampaignService) private readonly campaigns: CampaignService,
    @Inject(CreativeService) private readonly creatives: CreativeService,
  ) {}

  @Get()
  @Admin('marketing:write')
  @Doc({
    summary: 'Campaigns with creative counts by status',
    tags: ['campaigns'],
    response: z.object({ data: z.array(campaignSchema) }),
  })
  list() {
    return this.campaigns.list();
  }

  @Post()
  @Admin('marketing:write')
  @Audit('campaign.created', 'campaign')
  @Doc({
    summary: 'Create a campaign (placement, product selector, target segments, goal)',
    tags: ['campaigns'],
    body: campaignCreateSchema,
    response: campaignSchema,
    status: 201,
  })
  async create(@ZBody(campaignCreateSchema) body: z.infer<typeof campaignCreateSchema>) {
    const created = await this.campaigns.create(body);
    currentContext()?.audit.push({ entityId: created.id, before: null, after: { ...created } });
    return created;
  }

  @Post('preview-products')
  @Admin('marketing:write')
  @HttpCode(200)
  @Doc({
    summary: 'Preview the products a selector matches',
    tags: ['campaigns'],
    body: previewBody,
    response: productPreviewSchema,
  })
  preview(@ZBody(previewBody) body: z.infer<typeof previewBody>) {
    return this.campaigns.previewProducts(body.productSelector, body.limit);
  }

  @Get(':id')
  @Admin('marketing:write')
  @Doc({ summary: 'Campaign with its creatives', tags: ['campaigns'], response: campaignDetailSchema })
  get(@ZParam('id', uuid) id: string) {
    return this.campaigns.get(id);
  }

  @Patch(':id')
  @Admin('marketing:write')
  @Audit('campaign.updated', 'campaign')
  @Doc({
    summary: 'Update a campaign; status activate/pause/end',
    tags: ['campaigns'],
    body: campaignUpdateSchema,
    response: campaignSchema,
  })
  async update(
    @ZParam('id', uuid) id: string,
    @ZBody(campaignUpdateSchema) body: z.infer<typeof campaignUpdateSchema>,
  ) {
    const { before, after } = await this.campaigns.update(id, body);
    currentContext()?.audit.push({ entityId: id, before: { ...before }, after: { ...after } });
    return after;
  }

  @Post(':id/creatives/generate')
  @Admin('marketing:write')
  @Audit('creatives.generated', 'campaign')
  @Doc({
    summary: 'Generate creative drafts with the LLM (guardrails applied, human approval required)',
    tags: ['campaigns'],
    body: generateCreativesSchema,
    response: generateResponseSchema,
    status: 201,
  })
  async generate(
    @ZParam('id', uuid) id: string,
    @ZBody(generateCreativesSchema) body: z.infer<typeof generateCreativesSchema>,
  ) {
    const result = await this.creatives.generate(id, body);
    currentContext()?.audit.push({
      entityId: id,
      before: null,
      after: { jobId: result.jobId, creatives: result.creatives.length },
    });
    return result;
  }

  @Post(':id/creatives')
  @Admin('marketing:write')
  @Audit('creative.created', 'creative')
  @Doc({
    summary: 'Add a hand-written creative (goes through guardrails and review)',
    tags: ['campaigns'],
    body: creativeInputSchema,
    response: creativeSchema,
    status: 201,
  })
  async createCreative(
    @ZParam('id', uuid) id: string,
    @ZBody(creativeInputSchema) body: z.infer<typeof creativeInputSchema>,
  ) {
    const created = await this.creatives.createManual(id, body);
    currentContext()?.audit.push({ entityId: created.id, before: null, after: { ...created } });
    return created;
  }
}
