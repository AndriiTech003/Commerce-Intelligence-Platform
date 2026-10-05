import type { UserConfig } from 'vitest/config';

type TestOptions = NonNullable<UserConfig['test']>;

export function unitConfig(overrides?: TestOptions): UserConfig;
export function integrationConfig(overrides?: TestOptions): UserConfig;
