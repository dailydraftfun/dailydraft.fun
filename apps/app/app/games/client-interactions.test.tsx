import { describe, expect, test } from 'bun:test';
import {
  GAME_CATALOG_SCHEMA_VERSION,
  VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION,
  type VerifiedGameActivityPage,
  verifiedGameActivityContractFixtures,
} from '@dailydraft/contracts';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { FlipReceiptHistory } from './flip-receipt-history';
import type { GameCatalog } from './game-catalog';
import { GameLobby } from './game-lobby';
import { PolicyStatusBadge } from './policy-status';
import { VerifiedActivity } from './verified-activity';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('games client interactions', () => {
  test('updates the policy badge from resolved and rejected capability checks', async () => {
    const enabled = catalog();
    const resolved = await render(<PolicyStatusBadge loadCatalog={async () => enabled} />);

    expect(findByProp(resolved.root, 'data-policy-state').props['data-policy-state']).toBe(
      'enabled',
    );
    await unmount(resolved);

    const rejected = await render(
      <PolicyStatusBadge
        loadCatalog={async () => {
          throw new Error('offline');
        }}
      />,
    );

    expect(findByProp(rejected.root, 'data-policy-state').props['data-policy-state']).toBe(
      'malformed',
    );
    await unmount(rejected);
  });

  test('runs every lobby discovery action, including rules-only and non-rules previews', async () => {
    await withBrowser(async () => {
      const input = catalog();
      input.modes = input.modes.map((mode) => {
        if (mode.id === 'gacha') {
          return {
            ...mode,
            availableActions: [
              { href: '/games/gacha', id: 'view-preview', label: 'View Gacha fixture' },
            ],
            capabilitySource: { kind: 'fixture', name: 'gacha-capability', status: 'gated' },
            state: 'preview',
          };
        }
        if (mode.id === 'crash') {
          return {
            ...mode,
            availableActions: [],
            capabilitySource: { kind: 'fixture', name: 'rgs-fixture', status: 'gated' },
          };
        }
        return mode;
      });
      const renderer = await render(
        <GameLobby initialCatalog={input} loadCatalog={async () => input} />,
      );

      await runLinkCallbacks(renderer.root);

      expect(
        renderer.root.findAll((node) => node.type === 'a' && node.props.href === '/games/gacha'),
      ).toHaveLength(1);
      expect(
        renderer.root.findAll(
          (node) => node.type === 'a' && node.props.href === '/games/crash#rules',
        ).length,
      ).toBeGreaterThanOrEqual(1);
      await unmount(renderer);
    });
  });

  test('runs receipt, result, profile, rematch, discovery, and clipboard share actions', async () => {
    await withBrowser(async ({ copied }) => {
      const renderer = await render(
        <VerifiedActivity initialPage={activityPage()} initialState="ready" />,
      );

      await runLinkCallbacks(renderer.root);
      for (const link of renderer.root.findAll(
        (node) =>
          node.type === 'a' &&
          node.props.rel === 'noreferrer' &&
          typeof node.props.onClick === 'function',
      )) {
        await act(async () => link.props.onClick());
      }
      for (const button of renderer.root.findAllByType('button')) {
        await act(async () => button.props.onClick());
      }

      expect(copied).toHaveLength(4);
      expect(textOf(renderer.root)).toContain('Referral link copied');
      expect(textOf(renderer.root)).toContain('Sports Pack Gacha');
      expect(textOf(renderer.root)).toContain('Card Streak');
      await unmount(renderer);
    });
  });

  test('uses native share when available and reports a cancelled share', async () => {
    const shared: unknown[] = [];
    await withBrowser(
      async () => {
        const renderer = await render(
          <VerifiedActivity initialPage={activityPage()} initialState="ready" compact />,
        );
        const shareButtons = renderer.root.findAllByType('button');

        await act(async () => shareButtons[0]?.props.onClick());
        expect(shared).toHaveLength(1);
        expect(textOf(renderer.root)).toContain('Share opened');

        await act(async () => shareButtons[1]?.props.onClick());
        expect(textOf(renderer.root)).toContain('Share cancelled');
        await unmount(renderer);
      },
      {
        share: async (data) => {
          shared.push(data);
          if (shared.length === 2) throw new Error('cancelled');
        },
      },
    );
  });

  test('keeps a fixture card, loads older receipts, and resets pagination on filter change', async () => {
    const renderer = await render(<FlipReceiptHistory />);
    const keepButton = findButton(renderer.root, 'Keep fixture card');

    await act(async () => keepButton.props.onClick());
    expect(textOf(renderer.root)).toContain('Kept in fixture collection');
    expect(textOf(renderer.root)).toContain('No custody action occurred');

    await act(async () => findButton(renderer.root, 'Load older receipts').props.onClick());
    expect(
      findByProp(renderer.root, 'data-flip-history-count').props['data-flip-history-count'],
    ).toBe(6);

    const select = renderer.root.findByType('select');
    await act(async () => select.props.onChange({ target: { value: 'acquired' } }));
    expect(
      findByProp(renderer.root, 'data-flip-history-count').props['data-flip-history-count'],
    ).toBe(1);
    expect(renderer.root.findAllByType('article')).toHaveLength(1);
    await unmount(renderer);
  });
});

async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(element);
  });
  if (!renderer) throw new Error('React renderer did not initialize.');
  return renderer;
}

async function unmount(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => renderer.unmount());
}

async function runLinkCallbacks(root: ReactTestInstance): Promise<void> {
  const links = root.findAll(
    (node) =>
      node.type !== 'a' &&
      typeof node.props.href === 'string' &&
      typeof node.props.onClick === 'function',
  );
  for (const link of links) {
    await act(async () => link.props.onClick());
  }
}

function findByProp(root: ReactTestInstance, prop: string): ReactTestInstance {
  return root.find((node) => Object.hasOwn(node.props, prop));
}

function findButton(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.find((node) => node.type === 'button' && textOf(node).includes(label));
}

function textOf(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
}

async function withBrowser(
  run: (state: { copied: string[] }) => Promise<void>,
  options: { share?: (data: unknown) => Promise<void> } = {},
): Promise<void> {
  const copied: string[] = [];
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const previousShare = Object.getOwnPropertyDescriptor(navigator, 'share');
  const events: Event[] = [];

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dispatchEvent: (event: Event) => {
        events.push(event);
        return true;
      },
      location: { origin: 'https://app.dailydraft.fun' },
      sessionStorage: storage(),
    },
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        copied.push(value);
      },
    },
  });
  if (options.share) {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: options.share,
    });
  } else {
    Reflect.deleteProperty(navigator, 'share');
  }

  try {
    await run({ copied });
    expect(events.length).toBeGreaterThan(0);
  } finally {
    restoreProperty(globalThis, 'window', previousWindow);
    restoreProperty(navigator, 'clipboard', previousClipboard);
    restoreProperty(navigator, 'share', previousShare);
  }
}

function restoreProperty(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else Reflect.deleteProperty(target, key);
}

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function activityPage(): VerifiedGameActivityPage {
  return {
    asOf: '2026-07-29T20:00:00.000Z',
    data: Object.values(verifiedGameActivityContractFixtures),
    hasMore: false,
    nextCursor: null,
    schemaVersion: VERIFIED_GAME_ACTIVITY_SCHEMA_VERSION,
  };
}

function catalog(): GameCatalog {
  return {
    asOf: '2026-07-29T20:00:00.000Z',
    modes: [
      {
        availableActions: [
          { href: '/games/duel', id: 'direct-challenge', label: 'Challenge a wallet' },
          { href: '/games/duel', id: 'house-opponent', label: 'Play the house' },
        ],
        capabilitySource: { kind: 'runtime', name: 'duel-readiness', status: 'verified' },
        description: 'Open matching packs.',
        id: 'duel',
        name: 'Card Duel',
        reason: 'Ready on devnet.',
        state: 'playable',
      },
      {
        availableActions: [{ href: '/games/gacha', id: 'rip-pack', label: 'Rip a sports pack' }],
        capabilitySource: { kind: 'runtime', name: 'gacha-capability', status: 'verified' },
        description: 'Rip a sealed pool.',
        id: 'gacha',
        name: 'Sports Pack Gacha',
        reason: 'Ready on devnet.',
        state: 'playable',
      },
      {
        availableActions: [
          { href: '/games/marketplace-flip', id: 'view-preview', label: 'View fixture preview' },
        ],
        capabilitySource: { kind: 'fixture', name: 'rgs-fixture', status: 'gated' },
        description: 'Trade a committed quote.',
        id: 'flip',
        name: 'Marketplace Flip',
        reason: 'Fixture only.',
        state: 'preview',
      },
      {
        availableActions: [
          { href: '/games/crash', id: 'view-preview', label: 'View fixture preview' },
        ],
        capabilitySource: { kind: 'fixture', name: 'rgs-fixture', status: 'gated' },
        description: 'Build a card streak.',
        id: 'crash',
        name: 'Card Streak',
        reason: 'Fixture only.',
        state: 'preview',
      },
    ],
    network: 'solana-devnet',
    schemaVersion: GAME_CATALOG_SCHEMA_VERSION,
  };
}
