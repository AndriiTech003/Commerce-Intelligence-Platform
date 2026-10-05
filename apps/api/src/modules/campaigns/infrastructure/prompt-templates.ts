import { Injectable } from '@nestjs/common';
import { loadPromptFile, splitPromptFile } from '../../../shared/llm/prompt-files';
import type { PromptTemplates } from '../application/ports';

@Injectable()
export class FilePromptTemplates implements PromptTemplates {
  private readonly cache = new Map<string, { system: string; user: string }>();

  async load(version: string) {
    const hit = this.cache.get(version);
    if (hit) return hit;
    const parsed = splitPromptFile(await loadPromptFile(version));
    this.cache.set(version, parsed);
    return parsed;
  }
}
