import type { NextConfig } from 'next';

const config: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.pokemontcg.io',
      },
    ],
  },
  // Workspace packages resolve to TypeScript source for Next (see their
  // `import` export conditions), so Next has to compile them rather than expect
  // prebuilt `dist/` output. The journey smoke job runs `next dev` straight
  // after `bun install`, never through turbo.
  transpilePackages: ['@dailydraft/contracts', '@dailydraft/engine'],
};

export default config;
