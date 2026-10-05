import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '@cip/contracts';
import {
  compileRule,
  compileSegments,
  describeRule,
  evaluateSegments,
  KNOWN_FEATURES,
  quantile,
  ruleDepth,
  segmentRulesSchema,
  vipRules,
  type CompiledSegment,
  type FeatureMap,
  type RuleGroup,
  type SegmentMembership,
} from '@cip/personalization';
import { ConflictError, NotFoundError, ValidationFailedError } from '../../../shared/errors';
import { UNIT_OF_WORK, type UnitOfWork } from '../../tenancy';
import {
  PROFILE_SNAPSHOTS,
  PROFILE_STORE,
  SEGMENT_REPOSITORY,
  type ProfileSnapshotRepository,
  type ProfileStore,
  type SegmentRecord,
  type SegmentRepository,
} from './ports';

const LOCAL_TTL_MS = 5000;
const MAX_DEPTH = 5;

export function parseRules(rules: unknown): RuleGroup {
  const parsed = segmentRulesSchema.safeParse(rules);
  if (!parsed.success)
    throw new ValidationFailedError(
      'Segment rules are invalid',
      parsed.error.issues.map((issue) => ({ path: `rules.${issue.path.join('.')}`, message: issue.message })),
    );
  if (ruleDepth(parsed.data) > MAX_DEPTH)
    throw new ValidationFailedError(`Rules can be nested at most ${MAX_DEPTH} levels deep`);
  return parsed.data;
}

@Injectable()
export class SegmentService {
  private readonly compiled = new Map<
    string,
    { version: number; checkedAt: number; segments: CompiledSegment[] }
  >();

  constructor(
    @Inject(SEGMENT_REPOSITORY) private readonly repo: SegmentRepository,
    @Inject(PROFILE_SNAPSHOTS) private readonly snapshots: ProfileSnapshotRepository,
    @Inject(PROFILE_STORE) private readonly store: ProfileStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  private view(record: SegmentRecord, members: number) {
    return {
      id: record.id,
      key: record.key,
      name: record.name,
      rules: record.rules as unknown as Record<string, unknown>,
      description: describeRule(record.rules),
      priority: record.priority,
      isSystem: record.isSystem,
      members,
    };
  }

  async list() {
    return this.uow.run(async () => {
      const [records, counts] = await Promise.all([this.repo.list(), this.snapshots.memberCounts()]);
      return { data: records.map((r) => this.view(r, counts[r.key] ?? 0)) };
    });
  }

  async compiledFor(tenantId: string): Promise<CompiledSegment[]> {
    const cached = this.compiled.get(tenantId);
    const now = Date.now();
    if (cached && now - cached.checkedAt < LOCAL_TTL_MS) return cached.segments;
    const version = await this.store.segmentsVersion(tenantId);
    if (cached && cached.version === version) {
      cached.checkedAt = now;
      return cached.segments;
    }
    const records = await this.uow.runForTenant(tenantId, () => this.repo.list());
    const segments = compileSegments(
      records.flatMap((r) => {
        const parsed = segmentRulesSchema.safeParse(r.rules);
        return parsed.success ? [{ ...r, rules: parsed.data }] : [];
      }),
    );
    this.compiled.set(tenantId, { version, checkedAt: now, segments });
    return segments;
  }

  async evaluate(tenantId: string, features: FeatureMap, now = Date.now()): Promise<SegmentMembership[]> {
    return evaluateSegments(await this.compiledFor(tenantId), features, now);
  }

  private async changed(tenantId: string) {
    await this.store.bumpSegmentsVersion(tenantId);
    this.compiled.delete(tenantId);
  }

  async create(tenantId: string, input: { key: string; name: string; rules: unknown; priority: number }) {
    const rules = parseRules(input.rules);
    const created = await this.uow.run(async () => {
      if (await this.repo.findByKey(input.key))
        throw new ConflictError(`Segment ${input.key} already exists`);
      const record: SegmentRecord = {
        id: uuidv7(),
        key: input.key,
        name: input.name,
        rules,
        priority: input.priority,
        isSystem: false,
      };
      await this.repo.insert(record);
      return record;
    });
    await this.changed(tenantId);
    return this.view(created, 0);
  }

  async update(
    tenantId: string,
    id: string,
    patch: { name?: string | undefined; rules?: unknown; priority?: number | undefined },
  ) {
    const rules = patch.rules === undefined ? undefined : parseRules(patch.rules);
    const result = await this.uow.run(async () => {
      const before = await this.repo.find(id);
      if (!before) throw new NotFoundError('Segment', id);
      if (before.isSystem && rules && before.key !== 'vip')
        throw new ConflictError('Rules of system segments are fixed; create a custom segment instead');
      await this.repo.update(id, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(rules ? { rules } : {}),
      });
      const after = (await this.repo.find(id))!;
      return { before: this.view(before, 0), after: this.view(after, 0) };
    });
    await this.changed(tenantId);
    return result;
  }

  async remove(tenantId: string, id: string) {
    const before = await this.uow.run(async () => {
      const record = await this.repo.find(id);
      if (!record) throw new NotFoundError('Segment', id);
      if (record.isSystem) throw new ConflictError('System segments cannot be deleted');
      await this.repo.remove(id);
      return record;
    });
    await this.changed(tenantId);
    return this.view(before, 0);
  }

  async preview(rulesInput: unknown, now = Date.now()) {
    const rules = parseRules(rulesInput);
    const match = compileRule(rules);
    return this.uow.run(async () => {
      const [snapshots, total] = await Promise.all([this.snapshots.recent(20000), this.snapshots.count()]);
      let count = 0;
      const sample: Array<{ profileId: string; customerId: string | null; reasons: string[] }> = [];
      for (const snapshot of snapshots) {
        const features = Object.fromEntries(Object.entries(snapshot.features).filter(([k]) => k !== 'raw'));
        const result = match(features as FeatureMap, now);
        if (!result.matched) continue;
        count += 1;
        if (sample.length < 5)
          sample.push({
            profileId: snapshot.profileId,
            customerId: snapshot.customerId,
            reasons: result.reasons,
          });
      }
      return { count, total, description: describeRule(rules), sample };
    });
  }

  async features() {
    return this.uow.run(async () => ({
      features: KNOWN_FEATURES,
      categories: await this.repo.categories(),
      brands: await this.repo.brands(),
    }));
  }

  async refreshVipThreshold(tenantId: string): Promise<number | null> {
    const threshold = await this.uow.runForTenant(tenantId, async () => {
      const values = (await this.snapshots.ltvOfCustomers()).sort((a, b) => a - b);
      if (values.length < 10) return null;
      const p90 = Math.max(1, Math.round(quantile(values, 0.9)));
      const vip = await this.repo.findByKey('vip');
      if (!vip) return null;
      await this.repo.update(vip.id, { rules: vipRules(p90) });
      return p90;
    });
    if (threshold !== null) await this.changed(tenantId);
    return threshold;
  }
}
