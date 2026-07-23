import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GameModePreview } from '../game-mode-preview';
import type { PreviewMode } from '../game-preview-data';

const previewModes = new Set<PreviewMode>(['crash', 'flip', 'house']);

type GamePreviewPageProps = {
  params: Promise<{ mode: string }>;
};

export function generateStaticParams() {
  return [...previewModes].map((mode) => ({ mode }));
}

export async function generateMetadata({ params }: GamePreviewPageProps): Promise<Metadata> {
  const { mode } = await params;
  if (!isPreviewMode(mode)) return {};
  const title = mode === 'flip' ? 'Flip Gacha' : mode === 'crash' ? 'Crash' : 'Instant House';
  return {
    title: `${title} UX preview — Pack Duel Devnet`,
    description: `Fixture-backed ${title} player journey with no live funds or assets.`,
    robots: { follow: false, index: false, nocache: true },
  };
}

export default async function GamePreviewPage({ params }: GamePreviewPageProps) {
  const { mode } = await params;
  if (!isPreviewMode(mode)) notFound();
  return <GameModePreview mode={mode} />;
}

function isPreviewMode(mode: string): mode is PreviewMode {
  return previewModes.has(mode as PreviewMode);
}
