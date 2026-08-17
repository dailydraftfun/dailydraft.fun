import nextra from 'nextra';

const withNextra = nextra({
  search: {
    codeblocks: false,
  },
});

export default withNextra({
  images: {
    // Images are delivered by the existing CDN/origin, without Vercel transforms.
    unoptimized: true,
  },
  reactStrictMode: true,
});
