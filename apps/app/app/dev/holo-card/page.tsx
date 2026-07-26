import { HoloCard, type HoloCardRarity } from '../../components/holo-card';

const previews: Array<{
  imageUrl: string;
  name: string;
  rarity: HoloCardRarity;
  value: string;
}> = [
  {
    imageUrl: 'https://images.pokemontcg.io/base1/58_hires.png',
    name: 'Pikachu · Base Set',
    rarity: 'common',
    value: '$18.50',
  },
  {
    imageUrl: 'https://images.pokemontcg.io/base1/2_hires.png',
    name: 'Blastoise · Base Set',
    rarity: 'uncommon',
    value: '$54.00',
  },
  {
    imageUrl: 'https://images.pokemontcg.io/base1/10_hires.png',
    name: 'Mewtwo · Base Set',
    rarity: 'rare',
    value: '$42.00',
  },
  {
    imageUrl: 'https://images.pokemontcg.io/base1/4_hires.png',
    name: 'Charizard · Base Set',
    rarity: 'chase',
    value: '$72.50',
  },
];

export default function HoloCardPreviewPage() {
  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-10 sm:px-6">
      <header className="mx-auto mb-10 max-w-2xl text-center">
        <p className="proof-label">Component lab · CSS foil</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-primary sm:text-5xl">
          Holographic card treatments
        </h1>
        <p className="mt-4 text-sm leading-6 text-secondary">
          Move a pointer, touch-drag, or tab to a card. Reduced-motion preferences keep each rarity
          treatment rich while disabling tilt.
        </p>
      </header>
      <section
        aria-label="Holographic card rarity previews"
        className="grid justify-items-center gap-8 sm:grid-cols-2 xl:grid-cols-4"
      >
        {previews.map((preview, index) => (
          <HoloCard key={preview.rarity} priority={index === 0} {...preview} />
        ))}
      </section>
    </main>
  );
}
