import { describe, expect, test } from 'bun:test';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { CardStreakGame, CardStreakView } from './card-streak-game';
import type { CardStreakState } from './card-streak-state';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('Card Streak game surface', () => {
  test('renders game-first state, safety boundary, and accessible decisions', async () => {
    const renderer = await render(<CardStreakGame />);

    expect(textOf(renderer.root)).toContain('Pikachu');
    expect(textOf(renderer.root)).toContain('$43.50');
    expect(textOf(renderer.root)).toContain('Continue streak');
    expect(textOf(renderer.root)).toContain('End run');
    expect(textOf(renderer.root)).toContain('Demo score · no funds');
    expect(textOf(renderer.root)).toContain('No wallet. No funds. No custody.');
    expect(
      renderer.root.findByProps({ 'aria-label': 'Card Streak game' }).props['data-status'],
    ).toBe('active');

    await unmount(renderer);
  });

  test('reveals immediately, cashes out, and replays a clean run', async () => {
    const renderer = await render(<CardStreakGame />);

    await act(async () => findButton(renderer.root, 'Continue streak').props.onClick());
    expect(textOf(renderer.root)).toContain('Mewtwo');
    expect(textOf(renderer.root)).toContain('$85.50');

    await act(async () => findButton(renderer.root, 'End run').props.onClick());
    expect(textOf(renderer.root)).toContain('Run ended');
    expect(textOf(renderer.root)).toContain('You ended this run at a $85.50 demo score');

    const replay = findButton(renderer.root, 'Play again');
    await act(async () => replay.props.onClick());
    expect(textOf(renderer.root)).toContain('Run 02');
    expect(textOf(renderer.root)).toContain('Mewtwo');

    await unmount(renderer);
  });

  test('makes the final deterministic bust explicit before the action', async () => {
    const state: CardStreakState = {
      decisionCount: 3,
      round: 4,
      stageIndex: 3,
      status: 'active',
    };
    const actions: unknown[] = [];
    const renderer = await render(
      <CardStreakView dispatch={(action) => actions.push(action)} state={state} />,
    );

    expect(textOf(renderer.root)).toContain('Push past the edge');
    expect(textOf(renderer.root)).toContain('This fixture will bust');
    expect(textOf(renderer.root)).toContain('One more push busts this fixed run.');
    await act(async () => findButton(renderer.root, 'Push past the edge').props.onClick());
    expect(actions).toEqual([{ type: 'continue' }]);

    await unmount(renderer);
  });

  test('renders terminal bust with replay instead of conflicting decisions', async () => {
    const renderer = await render(
      <CardStreakView
        dispatch={() => undefined}
        state={{ decisionCount: 4, round: 1, stageIndex: 3, status: 'busted' }}
      />,
    );

    expect(textOf(renderer.root)).toContain('Busted');
    expect(textOf(renderer.root)).toContain('demo score is gone');
    expect(renderer.root.findAllByType('button')).toHaveLength(1);
    expect(textOf(renderer.root.findByType('button'))).toContain('Play again');

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

function findButton(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.find((node) => node.type === 'button' && textOf(node).includes(label));
}

function textOf(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
}
