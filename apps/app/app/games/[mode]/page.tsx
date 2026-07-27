import type { Metadata } from 'next';
import { GameModePreview } from '../game-mode-preview';
import { type PreviewMode, previewModeTitles } from '../game-preview-data';

// `flip` is deliberately absent: `games/flip/page.tsx` is a static segment that
// owns that path, and Next.js fails the build when `generateStaticParams` also
// claims it. The flip route renders the same `GameModePreview` when its gates
// are shut, so nothing is lost.
const previewModes = new Set<PreviewMode>(['crash', 'house']);

type GamePreviewPageProps = {
  params: Promise<{ mode: string }>;
};

export function generateStaticParams() {
  return [...previewModes].map((mode) => ({ mode }));
}

export async function generateMetadata({ params }: GamePreviewPageProps): Promise<Metadata> {
  const { mode } = await params;
  if (!isPreviewMode(mode)) return {};
  const title = previewModeTitles[mode];
  return {
    title: `${title} UX preview — DailyDraft Devnet`,
    description: `Fixture-backed ${title} player journey with no live funds or assets.`,
    robots: { follow: false, index: false, nocache: true },
  };
}

export default async function GamePreviewPage({ params }: GamePreviewPageProps) {
  const { mode } = await params;
  if (!isPreviewMode(mode)) {
    const { notFound } = await import('next/navigation');
    return notFound();
  }
  return <GameModePreview mode={mode} />;
}

function isPreviewMode(mode: string): mode is PreviewMode {
  return previewModes.has(mode as PreviewMode);
}
