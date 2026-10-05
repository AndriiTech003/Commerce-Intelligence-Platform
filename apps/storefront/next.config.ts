import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: root,
  transpilePackages: ['@cip/ui', '@cip/contracts', '@cip/api-client'],
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  htmlLimitedBots: /.*/,
  reactStrictMode: true,
  async rewrites() {
    const has = [{ type: 'header' as const, key: 'x-cip-store', value: '(?<store>[a-z0-9][a-z0-9-]{0,62})' }];
    return {
      beforeFiles: [
        { source: '/:path+', has, destination: '/:store/:path+' },
        { source: '/', has, destination: '/:store' },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default config;
