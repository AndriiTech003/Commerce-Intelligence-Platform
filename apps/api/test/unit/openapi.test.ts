import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FEATURE_MODULES } from '../../src/app.module';
import { generateOpenApi } from '../../src/openapi-emit';
import { collectControllers, collectRoutes } from '../../src/shared/http/openapi';
import { toProblem } from '../../src/shared/http/problem.filter';
import { NotFoundError } from '../../src/shared/errors';

describe('OpenAPI contract', () => {
  it('documents every route', () => {
    const undocumented = collectRoutes(collectControllers(FEATURE_MODULES)).filter(
      (r) => !r.doc || !r.surface,
    );
    expect(undocumented.map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });

  it('matches the committed openapi.json used to generate the typed client (run pnpm openapi on change)', () => {
    const committed = JSON.parse(
      readFileSync(new URL('../../../../packages/api-client/openapi.json', import.meta.url), 'utf8'),
    );
    expect(generateOpenApi()).toEqual(committed);
  });
});

describe('problem details', () => {
  it('maps domain errors and postgres errors', () => {
    expect(toProblem(new NotFoundError('Order', 'x'), '/v1/x').problem).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      instance: '/v1/x',
    });
    expect(toProblem({ code: '23505', detail: 'dup' }, '/').problem).toMatchObject({
      status: 409,
      code: 'CONFLICT',
    });
    expect(toProblem({ cause: { code: '42501' } }, '/').problem).toMatchObject({ status: 403 });
    expect(toProblem(new Error('x'), '/').problem).toMatchObject({ status: 500, code: 'INTERNAL' });
  });
});
