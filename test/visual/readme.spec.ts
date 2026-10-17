import { expect, test, type Page } from '@playwright/test';
import { openPanel, strings } from './harness';
import { README_NOW, readmeTimeline } from './readmeSample';

// The README's screenshots, from a made-up week (never anyone's real usage). Skipped in ordinary
// runs: they are pictures rather than checks. Run them with `npm run screenshots`.
test.skip(!process.env.README_SCREENSHOTS, 'run with npm run screenshots');
test.use({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 1, timezoneId: 'UTC' });

const IMAGES = 'docs/images';
const HOUR = 3_600_000;

/** Lets transitions settle before the picture. */
const settle = (page: Page) => page.waitForTimeout(400);

test('the week and the 5-hour window ahead, over a week of quota, sessions and tokens', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 1040 });
  const panel = await openPanel(page, 'dark');
  await panel.init(readmeTimeline('7d'));
  await expect(page.locator('.np-chart svg')).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${IMAGES}/timeline-dark.png` });
  expect(panel.problems).toEqual([]);
});

test('one working day zoomed in, with every value at a time', async ({ page }) => {
  const panel = await openPanel(page, 'dark');
  await panel.init(readmeTimeline('24h', { from: README_NOW - 11.5 * HOUR, to: README_NOW }));
  // The timeline at the top, under the cards of the week and the 5-hour window.
  await page.locator('.np-timeline').evaluate((card: HTMLElement) => {
    card.style.scrollMarginTop = '12px';
    card.scrollIntoView({ block: 'start' });
  });
  const box = (await page.locator('.np-hit').boundingBox())!;
  // Over a column: the quota lane would take a reading of its lines instead.
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height - 40);
  await expect(page.locator('.np-tooltip')).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${IMAGES}/zoom-dark.png` });
  expect(panel.problems).toEqual([]);
});

test('cost by token type, the tokens by type and the projects, in a light theme', async ({
  page,
}) => {
  const panel = await openPanel(page, 'light');
  await panel.init(readmeTimeline('7d'));
  await page
    .getByRole('group', { name: strings.splitLabel })
    .getByRole('button', { name: strings.splitByType })
    .click();
  await page.getByRole('button', { name: strings.byProject }).click();
  // The whole panel in view, to picture it from the timeline down to the end of the projects.
  const height = await page.locator('main').evaluate((main) => main.scrollHeight);
  await page.setViewportSize({ width: 1200, height });
  // Away from the rows, which would mark their time on the chart.
  await page.locator('.np-privacy').hover();
  await settle(page);
  const top = (await page.locator('.np-timeline').boundingBox())!.y - 12;
  const projects = (await page
    .getByRole('region', { name: strings.breakdownTitle })
    .boundingBox())!;
  await page.screenshot({
    path: `${IMAGES}/types-light.png`,
    clip: { x: 0, y: top, width: 1200, height: projects.y + projects.height + 12 - top },
  });
  expect(panel.problems).toEqual([]);
});
