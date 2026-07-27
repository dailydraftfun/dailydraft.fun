import { GameNavigation } from './game-navigation';

export default function GamesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <GameNavigation />
      {children}
    </>
  );
}
