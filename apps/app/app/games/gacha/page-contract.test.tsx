import { describe, expect, test } from 'bun:test';
import { FlipMachine } from '../flip/flip-machine';
import GachaPage, { generateMetadata } from './page';

describe('canonical gacha route', () => {
  test('publishes live no-index metadata', () => {
    const metadata = generateMetadata();

    expect(metadata.title).toBe('Sports Pack Gacha — DailyDraft Devnet');
    expect(metadata.robots).toEqual({ follow: false, index: false, nocache: true });
  });

  test('mounts the server-gated machine instead of a build-time capability mirror', () => {
    const page = GachaPage();

    expect(page.type).toBe('main');
    expect(page.props.children[0].type).toBe('header');
    expect(page.props.children[1].type).toBe(FlipMachine);
  });
});
