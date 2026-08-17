import type { NextConfig } from 'next';

const config: NextConfig = {
  images: {
    // Images are delivered by the existing CDN/origin, without Vercel transforms.
    unoptimized: true,
  },
};

export default config;
