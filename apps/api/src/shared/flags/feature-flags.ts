import { init, silentLogger, type FlagsClient, type Ruleset } from '@ashamrai/flags-node';
import type { Logger } from '@cip/observability';

export const FEATURE_FLAGS = Symbol('FEATURE_FLAGS');
export const AI_CREATIVES_FLAG = 'ai-creatives';

export function aiCreativesRuleset(options: {
  on: boolean;
  enabledTenants?: string[];
  disabledTenants?: string[];
}): Ruleset {
  const targets = [
    ...(options.enabledTenants?.length
      ? [{ variation: 'on', contextKind: 'tenant', keys: options.enabledTenants }]
      : []),
    ...(options.disabledTenants?.length
      ? [{ variation: 'off', contextKind: 'tenant', keys: options.disabledTenants }]
      : []),
  ];
  return {
    version: 1,
    segments: {},
    flags: {
      [AI_CREATIVES_FLAG]: {
        key: AI_CREATIVES_FLAG,
        name: 'AI creatives',
        kind: 'boolean',
        salt: AI_CREATIVES_FLAG,
        variations: [
          { id: 'on', value: true },
          { id: 'off', value: false },
        ],
        config: {
          on: true,
          offVariation: 'off',
          targets,
          rules: [],
          fallthrough: { variation: options.on ? 'on' : 'off' },
          version: 1,
        },
      },
    },
  };
}

export interface FeatureFlagState {
  source: string;
  initialized: boolean;
  relay: string | null;
}

export class FeatureFlags {
  private readonly client: FlagsClient;
  private initialized = false;
  private source = 'none';

  constructor(
    private readonly options: {
      relayUrl?: string | undefined;
      sdkKey?: string | undefined;
      fallback: boolean;
      bootstrap?: Ruleset;
      logger?: Logger;
    },
  ) {
    const remote = Boolean(options.relayUrl && options.sdkKey);
    this.client = init({
      sdkKey: options.sdkKey ?? 'srv-offline',
      ...(remote ? { baseUrl: options.relayUrl } : { offline: true }),
      bootstrap: options.bootstrap ?? aiCreativesRuleset({ on: options.fallback }),
      logger: silentLogger,
      events: { enabled: remote },
      diagnostics: { enabled: false },
      requestTimeoutMs: 2000,
    });
    void this.client.waitForInitialization({ timeoutMs: 3000 }).then((result) => {
      this.initialized = result.initialized;
      this.source = result.source;
      if (remote && !result.initialized)
        options.logger?.warn(
          { relay: options.relayUrl },
          'feature flag relay unavailable, using bootstrap defaults',
        );
    });
  }

  aiCreatives(tenantId: string): boolean {
    return this.client.boolVariation(
      AI_CREATIVES_FLAG,
      { kind: 'tenant', key: tenantId },
      this.options.fallback,
    );
  }

  state(): FeatureFlagState {
    return { source: this.source, initialized: this.initialized, relay: this.options.relayUrl ?? null };
  }

  async close(): Promise<void> {
    await this.client.close().catch(() => undefined);
  }
}
