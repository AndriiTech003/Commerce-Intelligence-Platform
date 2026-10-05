const MODULES = '^apps/api/src/modules/([^/]+)/';

module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      severity: 'error',
      comment: 'domain layers depend on nothing but the shared kernel and contracts',
      from: { path: `${MODULES}domain/` },
      to: {
        path: [
          '^apps/api/src/modules/[^/]+/(application|infrastructure|http)/',
          '^apps/api/src/db/',
          'node_modules/(@nestjs|drizzle-orm|pg|ioredis|amqplib|@clickhouse)/',
        ],
      },
    },
    {
      name: 'application-not-infrastructure',
      severity: 'error',
      from: { path: `${MODULES}application/` },
      to: {
        path: [
          '^apps/api/src/modules/[^/]+/(infrastructure|http)/',
          '^apps/api/src/db/',
          'node_modules/(drizzle-orm|pg)/',
        ],
      },
    },
    {
      name: 'http-not-infrastructure',
      severity: 'error',
      from: { path: `${MODULES}http/` },
      to: {
        path: [
          '^apps/api/src/modules/[^/]+/infrastructure/',
          '^apps/api/src/db/',
          'node_modules/(drizzle-orm|pg)/',
        ],
      },
    },
    {
      name: 'modules-talk-through-index',
      severity: 'error',
      from: { path: MODULES },
      to: {
        path: '^apps/api/src/modules/[^/]+/',
        pathNot: ['^apps/api/src/modules/$1/', '^apps/api/src/modules/[^/]+/index\\.ts$'],
      },
    },
    {
      name: 'db-schema-only-in-infrastructure',
      severity: 'error',
      from: {
        path: '^apps/api/src/',
        pathNot: ['^apps/api/src/modules/[^/]+/infrastructure/', '^apps/api/src/db/'],
      },
      to: { path: '^apps/api/src/db/schema' },
    },
    {
      name: 'apps-are-isolated',
      severity: 'error',
      from: { path: '^apps/([^/]+)/src/' },
      to: { path: '^apps/', pathNot: '^apps/$1/' },
    },
    {
      name: 'packages-do-not-import-apps',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'tracker-sdk-has-no-dependencies',
      severity: 'error',
      from: { path: '^packages/tracker-sdk/src/' },
      to: { dependencyTypes: ['npm', 'npm-dev', 'npm-peer', 'npm-optional', 'core'] },
    },
    {
      name: 'contracts-are-isomorphic',
      severity: 'error',
      from: { path: '^packages/contracts/src/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'no-circular-in-packages',
      severity: 'error',
      from: { path: '^packages/' },
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['(^|/)(dist|\\.next|test|coverage)/', '\\.test\\.tsx?$', '\\.config\\.ts$'] },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
};
