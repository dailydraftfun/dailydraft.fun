import { test as base, expect, type Route } from '@playwright/test';

import {
  DuelJourneyFixture,
  type FixtureResponse,
  journeyApiOrigin,
  journeyRpcUrl,
} from './journey-fixture';

type JourneyFixtures = {
  journey: DuelJourneyFixture;
  journeySeed: string;
};

export const test = base.extend<JourneyFixtures>({
  journeySeed: ['smoke', { option: true }],
  journey: async ({ journeySeed, page }, use) => {
    const journey = new DuelJourneyFixture(journeySeed);
    await page.addInitScript((bootstrap) => {
      window.__OPENPACKSDUEL_JOURNEY__ = bootstrap;
    }, journey.bootstrap());
    await page.route(journeyRpcUrl, async (route) => {
      await fulfill(route, () => journey.handleRpc(readJsonBody(route.request().postData())));
    });
    await page.route(`${journeyApiOrigin}/**`, async (route) => {
      const request = route.request();
      await fulfill(route, () =>
        journey.handleApi({
          authorization: request.headers().authorization,
          body: readJsonBody(request.postData()),
          method: request.method(),
          path: new URL(request.url()).pathname,
        }),
      );
    });
    await use(journey);
    journey.reset();
  },
});

export { expect };

async function fulfill(route: Route, handler: () => FixtureResponse): Promise<void> {
  try {
    const response = handler();
    await route.fulfill({
      body: response.status === 204 ? '' : JSON.stringify(response.body),
      contentType: 'application/json',
      status: response.status,
    });
  } catch (error) {
    await route.fulfill({
      body: JSON.stringify({
        detail: error instanceof Error ? error.message : 'Journey fixture request is invalid.',
        status: 422,
        title: 'Journey fixture setup failed',
        type: 'https://fixture.openpacksduel.test/problems/journey-fixture-setup',
      }),
      contentType: 'application/json',
      status: 422,
    });
  }
}

function readJsonBody(body: string | null): unknown {
  if (!body) return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error('Journey fixture request body is not valid JSON.');
  }
}
