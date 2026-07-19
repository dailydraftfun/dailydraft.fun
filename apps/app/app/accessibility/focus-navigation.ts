export type RovingTabKey = 'ArrowLeft' | 'ArrowRight' | 'End' | 'Home';

export function getRovingTabIndex(
  currentIndex: number,
  key: string,
  itemCount: number,
): number | null {
  if (itemCount <= 0 || currentIndex < 0 || currentIndex >= itemCount) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return itemCount - 1;
  if (key === 'ArrowRight') return (currentIndex + 1) % itemCount;
  if (key === 'ArrowLeft') return (currentIndex - 1 + itemCount) % itemCount;
  return null;
}

export function getTrappedFocusIndex(
  currentIndex: number,
  backwards: boolean,
  itemCount: number,
): number | null {
  if (itemCount <= 0) return null;
  if (currentIndex < 0) return backwards ? itemCount - 1 : 0;
  return backwards ? (currentIndex - 1 + itemCount) % itemCount : (currentIndex + 1) % itemCount;
}
