import { resolve } from 'node:path';
import type { NextConfig } from 'next';

const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:4000';

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: resolve(import.meta.dirname, '../..'),
  turbopack: { root: resolve(import.meta.dirname, '../..') },
  transpilePackages: ['@signaldesk/domain', 'geist'],
  poweredByHeader: false,
  agentRules: false,
  reactStrictMode: true,
  // The browser only ever talks to this origin, which keeps the session cookie first-party.
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiOrigin}/api/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default config;
