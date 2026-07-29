export type DemoCard = {
  imageUrl: string;
  name: string;
  value: number;
};

export const demoCards = {
  pikachu: {
    imageUrl: 'https://images.pokemontcg.io/base1/58_hires.png',
    name: 'Pikachu · Base Set',
    value: 18.5,
  },
  mewtwo: {
    imageUrl: 'https://images.pokemontcg.io/base1/10_hires.png',
    name: 'Mewtwo · Base Set',
    value: 42,
  },
  charizard: {
    imageUrl: 'https://images.pokemontcg.io/base1/4_hires.png',
    name: 'Charizard · Base Set',
    value: 72.5,
  },
} satisfies Record<string, DemoCard>;
