import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '../../../..');
const design = readFileSync(resolve(repositoryRoot, 'DESIGN.md'), 'utf8');
const surfaces = [
  'apps/app/app/globals.css',
  'apps/web/app/globals.css',
  'apps/docs/app/globals.css',
  'apps/mcp/public/styles.css',
] as const;

const colors = {
  accent: '#b8ff5a',
  'accent-foreground': '#10150d',
  agent: '#62d8ff',
  'bg-elevated': '#191e1b',
  'bg-hover': '#202721',
  'bg-primary': '#070807',
  'bg-secondary': '#0d100f',
  'bg-tertiary': '#131714',
  danger: '#ff6464',
  done: '#a78bfa',
  success: '#48e08a',
  'text-muted': '#909a90',
  'text-primary': '#f6f8f3',
  'text-secondary': '#b7c0b6',
  warning: '#f7c948',
} as const;

describe('cross-surface design system contract', () => {
  test('keeps DESIGN.md and every shipped surface on the canonical tokens', () => {
    for (const [name, value] of Object.entries(colors)) {
      expect(design).toContain(`${name}: "${value}"`);
      for (const surface of surfaces) {
        expect(readSurface(surface)).toContain(`--opd-${name}: ${value};`);
      }
    }

    for (const surface of surfaces) {
      const css = readSurface(surface);
      expect(css).toContain('--opd-font-sans: "DM Sans"');
      expect(css).toContain('--opd-font-mono: "JetBrains Mono"');
      expect(css).toContain('--opd-space-base: 4px;');
      expect(css).toContain('--opd-radius-xl: 16px;');
    }
  });

  test('meets WCAG AA contrast for text and semantic status tokens', () => {
    for (const foreground of ['text-primary', 'text-secondary', 'text-muted'] as const) {
      expect(contrast(colors[foreground], colors['bg-primary'])).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(colors['accent-foreground'], colors.accent)).toBeGreaterThanOrEqual(4.5);
    for (const background of ['success', 'warning', 'danger', 'agent', 'done'] as const) {
      expect(contrast(colors['bg-primary'], colors[background])).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('prevents unreadable type and synthesized weights', () => {
    for (const surface of surfaces) {
      const css = readSurface(surface);
      for (const match of css.matchAll(/font-size:\s*([0-9.]+)(px|rem)\s*;/g)) {
        const pixels = match[2] === 'rem' ? Number(match[1]) * 16 : Number(match[1]);
        expect(pixels, `${surface}: ${match[0]}`).toBeGreaterThanOrEqual(11);
      }
      expect(css).not.toMatch(/font-weight:\s*(?:8|9)00\s*;/);
      expect(css).toContain('font-synthesis: none;');
    }
  });

  test('keeps dialog, tab, and mobile information contracts enforceable', () => {
    const walletDialog = readFileSync(
      resolve(repositoryRoot, 'apps/app/app/solana/wallet-control.tsx'),
      'utf8',
    );
    const intentDialog = readFileSync(
      resolve(repositoryRoot, 'apps/app/app/solana/transaction-intent-review.tsx'),
      'utf8',
    );
    const duelArena = readFileSync(resolve(repositoryRoot, 'apps/app/app/duel-arena.tsx'), 'utf8');
    const appCss = readSurface('apps/app/app/globals.css');
    const webCss = readSurface('apps/web/app/globals.css');

    for (const dialog of [walletDialog, intentDialog]) {
      expect(dialog).toContain('useDialogFocus');
      expect(dialog).toContain('data-dialog-initial-focus');
      expect(dialog).toContain('aria-describedby');
      expect(dialog).toContain('tabIndex={-1}');
    }

    expect(duelArena).toContain('getRovingTabIndex');
    expect(duelArena).toContain('aria-controls="mode-panel-direct"');
    expect(duelArena).toContain('role="tabpanel"');
    expect(appCss).toMatch(/\.duel-proof span\s*\{\s*display:\s*inline;/);
    expect(appCss).toMatch(/\.pull-meta small\s*\{\s*display:\s*block;/);
    expect(webCss).not.toMatch(/\.nav-cta\s*\{[^}]*font-size:\s*0;/s);
  });
});

function readSurface(path: (typeof surfaces)[number]): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

function contrast(foreground: string, background: string): number {
  const brightest = Math.max(luminance(foreground), luminance(background));
  const darkest = Math.min(luminance(foreground), luminance(background));
  return (brightest + 0.05) / (darkest + 0.05);
}

function luminance(hex: string): number {
  const channels = hex
    .match(/[a-f0-9]{2}/gi)
    ?.map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  if (!channels || channels.length !== 3) throw new Error(`Invalid color: ${hex}`);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
