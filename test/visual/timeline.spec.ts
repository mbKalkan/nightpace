import { expect, test } from '@playwright/test';
import { lowestTextContrast } from './contrast';
import { openPanel, strings } from './harness';
import { sampleTimeline } from './sampleTimeline';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

for (const theme of ['dark', 'light', 'hcDark', 'hcLight'] as ThemeName[]) {
  test.describe(`${theme} theme`, () => {
    test('draws the quota, sessions and tokens on one time axis', async ({ page }) => {
      const panel = await openPanel(page, theme);
      await panel.init(sampleTimeline('24h'));

      await expect(page.getByRole('main', { name: strings.title })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(strings.title);
      const chart = page.locator('.np-chart svg');
      await expect(chart).toBeVisible();
      for (const text of [strings.quotaLane, strings.sessionsLane, strings.tokensLane]) {
        await expect(chart.getByText(text, { exact: true })).toBeVisible();
      }
      // Legends name every series, so color is never the only key.
      for (const text of [strings.fiveHour, strings.weekly, 'Opus', 'Fable', 'Sonnet']) {
        await expect(chart.getByText(text, { exact: true })).toBeVisible();
      }
      await expect(page.locator('.np-line.np-s-five')).toHaveCount(1);
      await expect(page.locator('.np-line.np-s-week')).toHaveCount(1);
      expect(await page.locator('.np-col').count()).toBeGreaterThan(10);
      await expect(page.getByRole('button', { name: strings.ranges['24h'] })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      // WCAG AA for every text, AAA in the dark high contrast theme (VS Code's own secondary
      // text in light high contrast is AA).
      expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(theme === 'hcDark' ? 7 : 4.5);
      await page.screenshot({ path: `${SCREENS}/timeline-${theme}.png` });
      expect(panel.problems).toEqual([]);
    });
  });
}

test('shows every value at a time on hover', async ({ page }) => {
  const panel = await openPanel(page, 'dark');
  await panel.init(sampleTimeline('24h'));
  const hit = page.locator('.np-hit');
  const box = (await hit.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.97, box.y + 40);
  const tooltip = page.locator('.np-tooltip');
  await expect(tooltip).toBeVisible();
  for (const text of [
    strings.fiveHour,
    strings.weekly,
    strings.sessions,
    'Opus',
    strings.requests,
  ]) {
    await expect(tooltip.getByText(text, { exact: true })).toBeVisible();
  }
  await expect(page.locator('.np-crosshair')).toHaveAttribute('visibility', 'visible');
  await expect(page.locator('.np-col.np-active')).toHaveCount(1);
  await page.screenshot({ path: `${SCREENS}/timeline-hover-dark.png` });

  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 60);
  await expect(tooltip).toBeHidden();
  expect(panel.problems).toEqual([]);
});

test('moves through time with the keyboard and reads the values out', async ({ page }) => {
  const panel = await openPanel(page, 'dark');
  await panel.init(sampleTimeline('24h'));
  const chart = page.getByRole('group', { name: strings.chartLabel });
  await chart.focus();
  await page.keyboard.press('End');
  await expect(page.locator('.np-tooltip')).toBeVisible();
  const last = await page.locator('.np-tooltip-title').textContent();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.np-tooltip-title')).not.toHaveText(last!);
  await expect(page.locator('[aria-live="polite"]')).toContainText(strings.sessions);
  await page.keyboard.press('Escape');
  await expect(page.locator('.np-tooltip')).toBeHidden();
  expect(panel.problems).toEqual([]);
});

test('shows the same values as a table', async ({ page }) => {
  const panel = await openPanel(page, 'light');
  await panel.init(sampleTimeline('24h'));
  await page.getByRole('button', { name: strings.showTable }).click();
  const table = page.getByRole('table');
  await expect(table).toBeVisible();
  await expect(table.getByRole('columnheader')).toHaveText([
    strings.time,
    strings.fiveHour,
    strings.weekly,
    strings.sessions,
    'Opus',
    'Fable',
    'Sonnet',
    strings.requests,
  ]);
  expect(await table.getByRole('row').count()).toBe(sampleTimeline('24h').buckets.length + 1);
  await page.screenshot({ path: `${SCREENS}/timeline-table-light.png` });
  await page.getByRole('button', { name: strings.showChart }).click();
  await expect(page.locator('.np-chart svg')).toBeVisible();
  expect(panel.problems).toEqual([]);
});

test('asks the host for another time range and dims the old one meanwhile', async ({ page }) => {
  const panel = await openPanel(page, 'dark');
  await panel.init(sampleTimeline('24h'));
  await page.getByRole('button', { name: strings.ranges['7d'] }).click();
  expect(await panel.sent()).toContainEqual({ type: 'range', range: '7d' });
  await expect(page.locator('.np-body')).toHaveClass(/np-loading/);

  await panel.post({ type: 'timeline', data: sampleTimeline('7d') });
  await expect(page.locator('.np-body')).not.toHaveClass(/np-loading/);
  await expect(page.getByRole('button', { name: strings.ranges['7d'] })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.screenshot({ path: `${SCREENS}/timeline-7d-dark.png` });
  expect(panel.problems).toEqual([]);
});

test('says when no quota has been recorded yet', async ({ page }) => {
  const panel = await openPanel(page, 'dark');
  await panel.init(sampleTimeline('24h', false));
  await expect(page.locator('.np-chart svg').getByText(strings.noQuotaYet)).toBeVisible();
  expect(panel.problems).toEqual([]);
});

test('fits a narrow panel without scrolling sideways', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 760 });
  const panel = await openPanel(page, 'dark');
  await panel.init(sampleTimeline('24h'));
  const overflow = await page.evaluate(
    () => document.getElementById('app')!.scrollWidth - document.getElementById('app')!.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SCREENS}/timeline-narrow-dark.png` });
  expect(panel.problems).toEqual([]);
});

test('tells the host it is ready, once', async ({ page }) => {
  const panel = await openPanel(page, 'dark');
  expect(await panel.sent()).toEqual([{ type: 'ready' }]);
});

test('says it is reading the logs until the first timeline arrives', async ({ page }) => {
  const panel = await openPanel(page, 'dark');
  await panel.init();
  await expect(page.getByText(strings.loading)).toBeVisible();
  await panel.post({ type: 'timeline', data: sampleTimeline('24h') });
  await expect(page.getByText(strings.loading)).toBeHidden();
  expect(panel.problems).toEqual([]);
});
