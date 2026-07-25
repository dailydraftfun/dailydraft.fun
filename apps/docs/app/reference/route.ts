import { ApiReference } from '@scalar/nextjs-api-reference';

export const GET = ApiReference({
  url: '/openapi.yaml',
  theme: 'saturn',
  layout: 'modern',
  darkMode: true,
  hideModels: false,
  hideTestRequestButton: true,
  metaData: {
    title: 'DailyDraft API Reference',
    description: 'Preview integration contract for pack duels on Solana devnet',
  },
});
