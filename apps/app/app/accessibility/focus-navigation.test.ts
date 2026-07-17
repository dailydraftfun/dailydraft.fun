import { describe, expect, test } from 'bun:test';
import { getRovingTabIndex, getTrappedFocusIndex } from './focus-navigation';

describe('accessible focus navigation', () => {
  test('wraps horizontal tab focus and supports Home and End', () => {
    expect(getRovingTabIndex(0, 'ArrowLeft', 3)).toBe(2);
    expect(getRovingTabIndex(2, 'ArrowRight', 3)).toBe(0);
    expect(getRovingTabIndex(1, 'Home', 3)).toBe(0);
    expect(getRovingTabIndex(1, 'End', 3)).toBe(2);
    expect(getRovingTabIndex(1, 'Enter', 3)).toBeNull();
  });

  test('wraps dialog focus in both directions', () => {
    expect(getTrappedFocusIndex(2, false, 3)).toBe(0);
    expect(getTrappedFocusIndex(0, true, 3)).toBe(2);
    expect(getTrappedFocusIndex(-1, false, 3)).toBe(0);
    expect(getTrappedFocusIndex(-1, true, 3)).toBe(2);
    expect(getTrappedFocusIndex(0, false, 0)).toBeNull();
  });
});
