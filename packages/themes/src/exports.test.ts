import { describe, expect, test } from 'bun:test';

import * as collectorCrypt from './collector-crypt.js';
import * as devnetDemo from './devnet-demo.js';
import * as themes from './index.js';

describe('theme package entrypoints', () => {
  test('publish both packs and the renderer-neutral scene adapter', () => {
    expect(themes).toMatchObject({
      COLLECTOR_CRYPT_THEME: expect.any(Object),
      DEVNET_DEMO_THEME: expect.any(Object),
      resolveThemePack: expect.any(Function),
      themeCssVariables: expect.any(Function),
      themeScenePresentation: expect.any(Function),
    });
    expect(collectorCrypt.COLLECTOR_CRYPT_THEME.id).toBe('collector-crypt.v1');
    expect(devnetDemo.DEVNET_DEMO_THEME.id).toBe('dailydraft-devnet.v1');
  });
});
