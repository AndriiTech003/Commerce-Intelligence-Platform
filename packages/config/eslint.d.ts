import type { Linter, Rule } from 'eslint';

export function createConfig(options?: { ignores?: string[]; reactFiles?: string[] }): Linter.Config[];
export const noComments: Rule.RuleModule;
