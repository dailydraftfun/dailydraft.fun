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
  // `@dailydraft/contracts/pull-rarity` resolves to TypeScript source for Next
  // (see that subpath's `import` export condition), so Next has to compile it
  // rather than expect a prebuilt `dist/`. Without this the journey smoke job —
  // which runs `next dev` straight after `bun install`, never through turbo —
  // cannot resolve the package at all.
  transpilePackages: ['@dailydraft/contracts'],
};

export default config;
