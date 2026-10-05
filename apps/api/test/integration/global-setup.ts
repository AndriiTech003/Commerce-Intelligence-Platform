import type { TestProject } from 'vitest/node';
import { provisionResources, type TestResources } from './support/resources';

declare module 'vitest' {
  export interface ProvidedContext {
    resources: TestResources;
  }
}

export default async function setup(project: TestProject) {
  const { resources, teardown } = await provisionResources();
  project.provide('resources', resources);
  return teardown;
}
