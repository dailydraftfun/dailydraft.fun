import { GameNavigation } from './game-navigation';
import { PolicyStatusBadge } from './policy-status';

export default function GamesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <GameNavigation />
      {children}
      <PolicyStatusBadge />
    </>
  );
}
