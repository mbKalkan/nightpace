import { expect, test, type Page } from '@playwright/test';
import { lowestTextContrast } from './contrast';
import { openPanel, strings } from './harness';
import { readmeTimeline } from './readmeSample';
import { sampleTimeline } from './sampleTimeline';
import type { ThemeName } from './themes';
import { PLANNED_SESSIONS, type TimeWindow } from '../../src/shared/protocol';

const SCREENS = 'test-results/screens';

/** How wide the chart is drawn; a redraw swaps its picture, so 0 for a moment. */
const drawnWidth = async (page: Page) =>
  (await page.locator('.np-chart svg').boundingBox())?.width ?? 0;

for (const theme of ['dark', 'light', 'hcDark', 'hcLight'] as ThemeName[]) {
  test.describe(`${theme} theme`, () => {
    test('draws the quota, sessions and tokens on one time axis', async ({ page }) => {
      const panel = await openPanel(page, theme);
      await panel.init(sampleTimeline('24h'));

      await expect(page.getByRole('main', { name: strings.title })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(strings.title);
      const chart = page.locator('.np-chart svg');
      await expect(chart).toBeVisible();
      for (const text of [strings.quotaLane, strings.sessionsLane, strings.tokenLanes.cost.model]) {
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
  const table = page.locator('.np-body').getByRole('table');
  await expect(table).toBeVisible();
  await expect(table.getByRole('columnheader')).toHaveText([
    strings.time,
    strings.fiveHour,
    strings.weekly,
    strings.sessions,
    'Opus',
    'Fable',
    'Sonnet',
    strings.cost,
    strings.requests,
  ]);
  expect(await table.getByRole('row').count()).toBe(sampleTimeline('24h').buckets.length + 1);
  await page.screenshot({ path: `${SCREENS}/timeline-table-light.png` });
  // A month's rows are days from the weekly reset, named by their date: weekdays repeat in it.
  const month = sampleTimeline('30d');
  await panel.post({ type: 'timeline', data: month });
  const newest = month.buckets.at(-1)!.start;
  const reset = month.weeklyResets.at(-1)!;
  expect((newest - reset) % (24 * 3_600_000)).toBe(0);
  await expect(table.locator('tbody tr').first().locator('th')).toHaveText(
    new Intl.DateTimeFormat('en', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(newest),
  );
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

const zoomRequests = async (panel: Awaited<ReturnType<typeof openPanel>>) =>
  (await panel.sent()).filter((message) => message.type === 'zoom') as Array<{
    type: 'zoom';
    window?: TimeWindow;
  }>;

test('zooms into a window dragged across the chart, and back out', async ({ page }) => {
  const panel = await openPanel(page, 'dark');
  const whole = sampleTimeline('24h');
  await panel.init(whole);
  const box = (await page.locator('.np-hit').boundingBox())!;
  const chartTop = async () => (await page.locator('.np-chart').boundingBox())!.y;
  const top = await chartTop();
  const y = box.y + 60;
  await page.mouse.move(box.x + box.width * 0.55, y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + box.width * 0.7, y, { steps: 5 });
  await expect(page.locator('.np-brush')).toBeVisible();
  await page.mouse.up({ button: 'right' });
  await expect(page.locator('.np-brush')).toHaveCount(0);

  // Shown at once from what the panel has, then asked of the host.
  await expect(page.locator('.np-zoom-label')).not.toBeEmpty();
  await expect(page.getByRole('button', { name: strings.resetZoom })).toBeEnabled();
  // Zooming moves nothing on the page: the chart stays under the pointer.
  expect(await chartTop()).toBe(top);
  await expect.poll(async () => (await zoomRequests(panel)).length).toBe(1);
  const [request] = await zoomRequests(panel);
  const span = whole.to - whole.from;
  expect(request.window!.from).toBeGreaterThan(whole.from + span * 0.5);
  expect(request.window!.to).toBeLessThan(whole.from + span * 0.75);

  await panel.post({ type: 'timeline', data: sampleTimeline('24h', true, request.window) });
  expect(await page.locator('.np-col').count()).toBeGreaterThan(20);
  await page.screenshot({ path: `${SCREENS}/timeline-zoom-dark.png` });

  await page.getByRole('button', { name: strings.resetZoom }).click();
  await expect.poll(async () => (await zoomRequests(panel)).at(-1)).toEqual({ type: 'zoom' });
  await panel.post({ type: 'timeline', data: whole });
  await expect(page.getByRole('button', { name: strings.resetZoom })).toBeDisabled();
  await expect(page.getByRole('button', { name: strings.zoomOut })).toBeDisabled();
  expect(panel.problems).toEqual([]);
});

test('zooms around the pointer with the scroll wheel and pans sideways', async ({ page }) => {
  const panel = await openPanel(page, 'dark');
  const whole = sampleTimeline('7d');
  await panel.init(whole);
  const box = (await page.locator('.np-hit').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.9, box.y + 60);
  // Over the plot the wheel never scrolls the panel, even with nothing to zoom out to.
  const scrolledOut = await page.evaluate(() => {
    const event = new WheelEvent('wheel', { deltaY: 100, cancelable: true, bubbles: true });
    document.querySelector('.np-hit')!.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(scrolledOut).toBe(true);
  // The rest of a scroll goes where its first wheel event went: the redraw must keep that element.
  await page.evaluate(() => {
    (window as unknown as { firstHit: Element }).firstHit = document.querySelector('.np-hit')!;
  });
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => (await zoomRequests(panel)).length).toBe(1);
  expect(
    await page.evaluate(() => {
      const first = (window as unknown as { firstHit: Element }).firstHit;
      return first.isConnected && first === document.querySelector('.np-hit');
    }),
  ).toBe(true);
  const [zoomed] = await zoomRequests(panel);
  const span = whole.to - whole.from;
  expect(zoomed.window!.to - zoomed.window!.from).toBeLessThan(span * 0.6);
  // The time under the pointer stays under it.
  const pointer = whole.from + span * 0.9;
  const share = (pointer - zoomed.window!.from) / (zoomed.window!.to - zoomed.window!.from);
  expect(share).toBeCloseTo(0.9, 1);

  const shown = sampleTimeline('7d', true, zoomed.window);
  await panel.post({ type: 'timeline', data: shown });
  await page.mouse.wheel(-300, 0);
  await expect.poll(async () => (await zoomRequests(panel)).length).toBe(2);
  const panned = (await zoomRequests(panel))[1].window!;
  // Earlier by as long as it was, no shorter or longer.
  expect(panned.from).toBeLessThan(shown.from);
  expect(panned.to - panned.from).toBe(shown.to - shown.from);

  const moved = sampleTimeline('7d', true, panned);
  await panel.post({ type: 'timeline', data: moved });
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 300);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await zoomRequests(panel)).length).toBe(3);
  const later = (await zoomRequests(panel))[2].window!;
  expect(later.from).toBeGreaterThan(moved.from);
  expect(later.to - later.from).toBe(moved.to - moved.from);
  expect(panel.problems).toEqual([]);
});

test('pans when dragged with the left button', async ({ page }) => {
  const panel = await openPanel(page, 'dark');
  const whole = sampleTimeline('7d');
  await panel.init(whole);
  const box = (await page.locator('.np-hit').boundingBox())!;
  const y = box.y + 60;
  // With the whole range shown there is nowhere to go.
  await page.mouse.move(box.x + box.width * 0.5, y);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(box.x + box.width * 0.3, y, { steps: 5 });
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(300);
  expect(await zoomRequests(panel)).toEqual([]);

  const span = whole.to - whole.from;
  const shown = sampleTimeline('7d', true, {
    from: whole.from + span * 0.25,
    to: whole.from + span * 0.5,
  });
  await panel.post({ type: 'timeline', data: shown });
  await page.mouse.move(box.x + box.width * 0.5, y);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(box.x + box.width * 0.25, y, { steps: 5 });
  await expect(page.locator('.np-chart.np-panning')).toHaveCount(1);
  await page.mouse.up({ button: 'left' });
  await expect(page.locator('.np-chart.np-panning')).toHaveCount(0);
  await expect.poll(async () => (await zoomRequests(panel)).length).toBe(1);
  const [panned] = await zoomRequests(panel);
  // Dragged left by a quarter of the plot: a quarter of the window later, as long as it was.
  const length = shown.to - shown.from;
  expect(panned.window!.to - panned.window!.from).toBe(length);
  expect((panned.window!.from - shown.from) / length).toBeCloseTo(0.25, 1);
  expect(panel.problems).toEqual([]);
});

test('double-click shows the whole range, and Escape lets go of a selection', async ({ page }) => {
  const panel = await openPanel(page, 'dark');
  const whole = sampleTimeline('24h');
  await panel.init(whole);
  const box = (await page.locator('.np-hit').boundingBox())!;
  const y = box.y + 60;
  await page.mouse.move(box.x + box.width * 0.4, y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + box.width * 0.6, y, { steps: 5 });
  await expect(page.locator('.np-brush')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.np-brush')).toHaveCount(0);
  await page.mouse.up({ button: 'right' });
  // Nothing at the whole range either.
  await page.mouse.dblclick(box.x + box.width * 0.5, y);
  await page.waitForTimeout(300);
  expect(await zoomRequests(panel)).toEqual([]);

  const span = whole.to - whole.from;
  const window = { from: whole.from + span * 0.5, to: whole.from + span * 0.75 };
  await panel.post({ type: 'timeline', data: sampleTimeline('24h', true, window) });
  await expect(page.locator('.np-chart.np-zoomed')).toHaveCount(1);
  await page.mouse.dblclick(box.x + box.width * 0.5, y);
  await expect.poll(async () => (await zoomRequests(panel)).at(-1)).toEqual({ type: 'zoom' });
  await expect(page.locator('.np-chart.np-zoomed')).toHaveCount(0);
  expect(panel.problems).toEqual([]);
});

test('Shift and the arrow keys move the zoomed window', async ({ page }) => {
  const panel = await openPanel(page, 'light');
  const whole = sampleTimeline('7d');
  const span = whole.to - whole.from;
  const shown = sampleTimeline('7d', true, {
    from: whole.from + span * 0.25,
    to: whole.from + span * 0.5,
  });
  await panel.init(shown);
  await page.getByRole('group', { name: strings.chartLabel }).focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(async () => (await zoomRequests(panel)).length).toBe(1);
  const [moved] = await zoomRequests(panel);
  const length = shown.to - shown.from;
  expect(moved.window!.to - moved.window!.from).toBe(length);
  expect(moved.window!.from).toBe(shown.from - length / 4);
  expect(panel.problems).toEqual([]);
});

test('a row of the table marks its time on the chart and zooms to it', async ({ page }) => {
  const panel = await openPanel(page, 'dark');
  const data = sampleTimeline('7d');
  await panel.init(data);
  const table = page.getByRole('region', { name: strings.breakdownTitle }).getByRole('table');
  const row = table.locator('tbody tr').first();
  await expect(row).toHaveAttribute('title', strings.zoomToSession);
  await row.locator('td').nth(2).hover();
  await expect(page.locator('.np-mark')).toHaveCount(1);
  await page.mouse.move(0, 0);
  await expect(page.locator('.np-mark')).toHaveCount(0);
  // The keyboard reaches a row through its first cell.
  const second = table.locator('tbody tr').nth(1).getByRole('button');
  await second.focus();
  await expect(page.locator('.np-mark')).toHaveCount(1);
  await second.blur();
  await expect(page.locator('.np-mark')).toHaveCount(0);

  // The table is sorted by cost, most first, like the session list.
  const session = data.sessionList[0];
  await row.locator('td').nth(2).click();
  await expect.poll(async () => (await zoomRequests(panel)).length).toBe(1);
  const [zoomed] = await zoomRequests(panel);
  expect(zoomed.window!.from).toBeLessThan(session.first);
  expect(zoomed.window!.to).toBeGreaterThan(session.last);
  await expect(page.locator('.np-mark')).toHaveCount(0);
  await expect(page.locator('.np-zoom-label')).toContainText('·');

  await second.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await zoomRequests(panel)).length).toBe(2);
  expect(panel.problems).toEqual([]);
});

test('zooms with the plus and minus keys and the buttons', async ({ page }) => {
  const panel = await openPanel(page, 'light');
  const whole = sampleTimeline('24h');
  await panel.init(whole);
  await page.getByRole('group', { name: strings.chartLabel }).focus();
  await page.keyboard.press('End');
  await page.keyboard.press('+');
  await expect.poll(async () => (await zoomRequests(panel)).length).toBe(1);
  const [byKey] = await zoomRequests(panel);
  expect(byKey.window!.to).toBe(whole.to);
  expect(byKey.window!.to - byKey.window!.from).toBeCloseTo((whole.to - whole.from) / 2, -3);
  await panel.post({ type: 'timeline', data: sampleTimeline('24h', true, byKey.window) });
  await page.screenshot({ path: `${SCREENS}/timeline-zoom-light.png` });

  await page.getByRole('button', { name: strings.zoomOut }).click();
  await expect.poll(async () => (await zoomRequests(panel)).at(-1)).toEqual({ type: 'zoom' });
  expect(panel.problems).toEqual([]);
});

test.describe('where the tokens went', () => {
  for (const theme of ['dark', 'light'] as ThemeName[]) {
    test(`lists sessions and projects, most cost first (${theme})`, async ({ page }) => {
      const panel = await openPanel(page, theme);
      const data = sampleTimeline('7d');
      await panel.init(data);
      const section = page.getByRole('region', { name: strings.breakdownTitle });
      await section.scrollIntoViewIfNeeded();
      const table = section.getByRole('table');
      await expect(table.getByRole('columnheader')).toHaveText([
        strings.project,
        strings.started,
        strings.active,
        strings.requests,
        strings.cost,
        strings.tokens,
        strings.fromCache,
        strings.share,
        strings.modelsColumn,
        strings.effort,
      ]);
      await expect(table.getByRole('columnheader', { name: strings.cost })).toHaveAttribute(
        'aria-sort',
        'descending',
      );
      await expect(table.locator('tbody tr').first()).toContainText('$');
      // Twelve rows and a way to the rest.
      expect(data.sessionList.length).toBeGreaterThan(12);
      await expect(table.locator('tbody tr')).toHaveCount(12);
      await expect(table.locator('tbody tr').first().locator('th')).toHaveText(
        /atlas|beacon-api|notes/,
      );
      await expect(table.locator('tbody tr').first()).toContainText('xhigh');
      await page.screenshot({ path: `${SCREENS}/breakdown-sessions-${theme}.png`, fullPage: true });

      await section.getByRole('button', { name: strings.byProject }).click();
      await expect(table.locator('tbody tr')).toHaveCount(3);
      await expect(table.getByRole('columnheader').nth(1)).toHaveText(strings.sessions);
      expect(await lowestTextContrast(page, '.np-breakdown')).toBeGreaterThanOrEqual(4.5);
      await section.screenshot({ path: `${SCREENS}/breakdown-projects-${theme}.png` });
      expect(panel.problems).toEqual([]);
    });
  }

  test('sorts by a column and shows every row on request', async ({ page }) => {
    const panel = await openPanel(page, 'dark');
    const data = sampleTimeline('7d');
    await panel.init(data);
    const section = page.getByRole('region', { name: strings.breakdownTitle });
    const table = section.getByRole('table');
    await table.getByRole('button', { name: strings.started }).click();
    await expect(table.getByRole('columnheader', { name: strings.started })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    const newest = Math.max(...data.sessionList.map((session) => session.first));
    const firstStarted = await table
      .locator('tbody tr')
      .first()
      .locator('td')
      .first()
      .textContent();
    expect(firstStarted).toContain(
      new Intl.DateTimeFormat('en', {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(newest),
    );
    await table.getByRole('button', { name: strings.started }).click();
    await expect(table.getByRole('columnheader', { name: strings.started })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );

    await section
      .getByRole('button', {
        name: strings.showAll.replace('{0}', String(data.sessionList.length)),
      })
      .click();
    await expect(table.locator('tbody tr')).toHaveCount(data.sessionList.length);
    expect(panel.problems).toEqual([]);
  });

  test('remembers grouping by project while the panel lives', async ({ page }) => {
    const panel = await openPanel(page, 'dark');
    await panel.init(sampleTimeline('24h'));
    await page.getByRole('button', { name: strings.byProject }).click();
    await panel.post({ type: 'timeline', data: sampleTimeline('24h') });
    await expect(page.getByRole('button', { name: strings.byProject })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(panel.problems).toEqual([]);
  });
});

test.describe('tokens by type', () => {
  for (const theme of ['dark', 'light'] as ThemeName[]) {
    test(`lists the tokens and cost of each kind, and what the cache saved (${theme})`, async ({
      page,
    }) => {
      const panel = await openPanel(page, theme);
      const data = sampleTimeline('7d');
      await panel.init(data);
      const section = page.getByRole('region', { name: strings.tokenDetailsTitle });
      await expect(section).toBeVisible();
      const table = section.getByRole('table');
      await expect(table.getByRole('columnheader')).toHaveText([
        strings.type,
        strings.tokens,
        strings.shareOfTokens,
        strings.cost,
        strings.shareOfCost,
      ]);
      const names = await table.locator('tbody th').allTextContents();
      expect(names[0]).toBe(strings.tokenDetails.input);
      expect(names).toContain(strings.tokenDetails.cacheRead);
      expect(names).toContain(strings.tokenDetails.output);
      expect(names.at(-1)).toBe(strings.total);
      // The cache saved money on the sample, as it does in Claude Code.
      const details = data.tokenDetails;
      expect(details.cacheRead.tokens).toBeGreaterThan(0);
      const figures = section.locator('.np-details-summary');
      await expect(figures.locator('dt')).toHaveText([
        strings.cacheReadShare,
        strings.cacheSaved,
        strings.uncachedCost,
      ]);
      await expect(figures.locator('dd').first()).toHaveText(/^\d+%$/);
      await expect(figures.locator('dd').nth(1)).toHaveText(/^\$[\d,]+(\.\d\d)?$/);
      expect(await lowestTextContrast(page, '.np-details')).toBeGreaterThanOrEqual(4.5);
      await section.screenshot({ path: `${SCREENS}/token-details-${theme}.png` });

      // Each session's tokens by type on pointing at them.
      const tokensCell = page
        .getByRole('region', { name: strings.breakdownTitle })
        .locator('tbody tr')
        .first()
        .locator('td')
        .nth(4);
      await expect(tokensCell).toHaveAttribute('title', new RegExp(strings.tokenTypes.cacheRead));
      expect(panel.problems).toEqual([]);
    });
  }

  test('is left out when the window has no requests', async ({ page }) => {
    const panel = await openPanel(page, 'dark');
    const data = sampleTimeline('24h');
    // A window before any request in the sample.
    await panel.init(
      sampleTimeline('24h', true, { from: data.extent.from, to: data.extent.from + 3_600_000 }),
    );
    await expect(page.getByRole('region', { name: strings.tokenDetailsTitle })).toBeHidden();
    // The timeline keeps its half beside the cost, so zooming in and out doesn't resize it.
    const main = (await page.locator('main').boundingBox())!;
    await expect.poll(() => drawnWidth(page)).toBeGreaterThan(main.width * 0.4);
    expect(await drawnWidth(page)).toBeLessThan(main.width * 0.55);
    await expect(page.getByRole('region', { name: strings.spendTitle })).toBeVisible();
    expect(panel.problems).toEqual([]);
  });

  test('sits beside the timeline, each half the width, where both fit', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    const panel = await openPanel(page, 'dark');
    await panel.init(sampleTimeline('7d'));
    const section = page.getByRole('region', { name: strings.tokenDetailsTitle });
    await expect(section).toBeVisible();
    const main = (await page.locator('main').boundingBox())!;
    const chart = (await page.locator('.np-body').boundingBox())!;
    const details = (await section.boundingBox())!;
    expect(details.x).toBeGreaterThan(chart.x + chart.width);
    await expect.poll(() => drawnWidth(page)).toBeGreaterThan(main.width * 0.4);
    expect(await drawnWidth(page)).toBeLessThan(main.width * 0.55);
    // The cost above the tokens by type; the two halves start and end together.
    const timeline = (await page.locator('.np-timeline').boundingBox())!;
    const spend = (await page.getByRole('region', { name: strings.spendTitle }).boundingBox())!;
    expect(Math.abs(spend.y - timeline.y)).toBeLessThan(1);
    expect(details.y).toBeGreaterThan(spend.y + spend.height);
    expect(Math.abs(details.y + details.height - (timeline.y + timeline.height))).toBeLessThan(1);
    const overflow = await page.evaluate(
      () =>
        document.getElementById('app')!.scrollWidth - document.getElementById('app')!.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SCREENS}/timeline-wide-dark.png` });

    // The table view keeps its columns in the half, scrolling sideways if it must.
    await page.getByRole('button', { name: strings.showTable }).click();
    await expect(page.locator('.np-body table')).toBeVisible();
    expect((await section.boundingBox())!.x).toBeGreaterThan(main.x + main.width * 0.45);

    await page.getByRole('button', { name: strings.showChart }).click();
    await expect(page.locator('.np-chart svg')).toBeVisible();

    // Measured against the chart's container: a resize redraws the chart in a new element.
    const body = page.locator('.np-body');
    const offset = async () => {
      const [sectionBox, bodyBox] = [await section.boundingBox(), await body.boundingBox()];
      return { x: sectionBox!.x - bodyBox!.x, y: sectionBox!.y - bodyBox!.y };
    };

    // At the narrowest width with two halves, the table still fits its half.
    await page.setViewportSize({ width: 1100, height: 900 });
    await expect.poll(async () => (await offset()).x).toBeGreaterThan(400);
    const tableOverflow = await section
      .locator('.np-table-scroll')
      .evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(tableOverflow).toBeLessThanOrEqual(0);
    await section.screenshot({ path: `${SCREENS}/token-details-half-dark.png` });

    // Narrower, the tokens by type go under the timeline.
    await page.setViewportSize({ width: 1000, height: 900 });
    await expect.poll(async () => (await offset()).y).toBeGreaterThan(300);
    expect((await offset()).x).toBeLessThan(1);
    expect(panel.problems).toEqual([]);
  });
});

test.describe('tokens by effort level', () => {
  for (const theme of ['dark', 'light'] as ThemeName[]) {
    test(`stacks the columns by effort level instead of model (${theme})`, async ({ page }) => {
      const panel = await openPanel(page, theme);
      await panel.init(sampleTimeline('7d'));
      const split = page.getByRole('group', { name: strings.splitLabel });
      await split.getByRole('button', { name: strings.splitByEffort }).click();
      const chart = page.locator('.np-chart svg');
      await expect(chart.getByText(strings.tokenLanes.cost.effort, { exact: true })).toBeVisible();
      for (const text of ['medium', 'high', 'xhigh', strings.noEffort]) {
        await expect(chart.getByText(text, { exact: true })).toBeVisible();
      }
      await expect(chart.getByText('Opus', { exact: true })).toHaveCount(0);
      await expect(page.locator('.np-bar.np-e-xhigh').first()).toBeVisible();
      expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(4.5);

      // Under the pace cards: in view before pointing at it.
      await page.locator('.np-chart').scrollIntoViewIfNeeded();
      const column = (await page.locator('.np-bar.np-e-xhigh').last().boundingBox())!;
      await page.mouse.move(column.x + column.width / 2, column.y + column.height / 2);
      await expect(page.locator('.np-tooltip').getByText('xhigh', { exact: true })).toBeVisible();
      await page.screenshot({ path: `${SCREENS}/timeline-effort-${theme}.png` });

      await page.getByRole('button', { name: strings.showTable }).click();
      await expect(page.locator('.np-body').getByRole('columnheader')).toContainText([
        'medium',
        'high',
        'xhigh',
        strings.noEffort,
      ]);
      await expect(split.getByRole('button', { name: strings.splitByEffort })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(panel.problems).toEqual([]);
    });
  }
});

test.describe('cost and token types', () => {
  for (const theme of ['dark', 'light'] as ThemeName[]) {
    test(`shows what the usage would cost at API prices (${theme})`, async ({ page }) => {
      const panel = await openPanel(page, theme);
      const data = sampleTimeline('7d');
      await panel.init(data);
      const spend = page.getByRole('region', { name: strings.spendTitle });
      await expect(spend).toBeVisible();
      for (const label of [
        strings.spendToday,
        strings.spendLast7Days,
        strings.spendLast30Days,
        strings.spendPerActiveDay,
      ]) {
        await expect(spend.getByText(label, { exact: true })).toBeVisible();
      }
      await expect(spend.locator('dd').nth(2)).toHaveText(/^\$[\d,]+(\.\d\d)?$/);
      const chart = page.locator('.np-chart svg');
      await expect(chart.getByText(strings.tokenLanes.cost.model, { exact: true })).toBeVisible();
      await expect(chart.getByText(/in this period/)).toBeVisible();
      expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(4.5);
      await page.screenshot({ path: `${SCREENS}/cost-${theme}.png` });
      expect(panel.problems).toEqual([]);
    });

    test(`splits the columns by token type, in tokens (${theme})`, async ({ page }) => {
      const panel = await openPanel(page, theme);
      await panel.init(sampleTimeline('24h'));
      await page
        .getByRole('group', { name: strings.measureLabel })
        .getByRole('button', { name: strings.measures.tokens })
        .click();
      await page
        .getByRole('group', { name: strings.splitLabel })
        .getByRole('button', { name: strings.splitByType })
        .click();
      const chart = page.locator('.np-chart svg');
      await expect(chart.getByText(strings.tokenLanes.tokens.type, { exact: true })).toBeVisible();
      for (const type of ['input', 'cacheWrite', 'cacheRead', 'output'] as const) {
        await expect(chart.getByText(strings.tokenTypes[type], { exact: true })).toBeVisible();
      }
      await expect(page.locator('.np-bar.np-t-cacheRead').first()).toBeVisible();
      await expect(
        page.locator('.np-note-text', { hasText: strings.measureNotes.tokens }),
      ).toBeVisible();
      const section = page.getByRole('region', { name: strings.breakdownTitle });
      await expect(section.getByRole('columnheader', { name: strings.tokens })).toHaveAttribute(
        'aria-sort',
        'descending',
      );
      // Output is a sliver next to the cache reads in tokens; the tooltip still lists it.
      // Under the pace cards: in view before pointing at it.
      await page.locator('.np-chart').scrollIntoViewIfNeeded();
      const column = (await page.locator('.np-bar.np-t-cacheRead').last().boundingBox())!;
      await page.mouse.move(column.x + column.width / 2, column.y + column.height / 2);
      const tooltip = page.locator('.np-tooltip');
      await expect(tooltip.getByText(strings.tokenTypes.output, { exact: true })).toBeVisible();
      await expect(tooltip.getByText(strings.cost, { exact: true })).toBeVisible();
      expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(4.5);
      await page.screenshot({ path: `${SCREENS}/types-${theme}.png` });
      expect(panel.problems).toEqual([]);
    });
  }
});

test('scrolls in one place, never the page around the panel', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 500 });
  const panel = await openPanel(page, 'dark');
  await panel.init(sampleTimeline('7d'));
  await expect(page.getByRole('region', { name: strings.breakdownTitle })).toBeAttached();
  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    app:
      document.getElementById('app')!.scrollHeight - document.getElementById('app')!.clientHeight,
  }));
  expect(overflow.page).toBeLessThanOrEqual(0);
  expect(overflow.app).toBeGreaterThan(0);
  expect(panel.problems).toEqual([]);
});

test.describe('pace', () => {
  for (const theme of ['dark', 'light'] as ThemeName[]) {
    test(`says when the week and the 5-hour window run out (${theme})`, async ({ page }) => {
      await page.setViewportSize({ width: 1400, height: 900 });
      const panel = await openPanel(page, theme);
      const data = readmeTimeline('7d');
      await panel.init(data);
      const week = page.getByRole('region', { name: strings.weekTitle });
      const window = page.getByRole('region', { name: strings.windowTitle });
      await expect(week.locator('dt')).toHaveText([
        strings.used,
        strings.resets,
        strings.runsOutAtPace,
      ]);
      await expect(week.locator('dd').first()).toHaveText(/^\d+%$/);
      await expect(window.locator('dt')).toHaveText([
        strings.used,
        strings.resets,
        strings.timeLeft,
      ]);
      // A row for each kind of session, a column for each number of sessions at once.
      for (const card of [week, window]) {
        const table = card.getByRole('table');
        await expect(table.getByRole('columnheader')).toHaveCount(PLANNED_SESSIONS + 1);
        await expect(table.locator('tbody tr')).toHaveCount(data.pace!.rates.length);
        await expect(card.locator('.np-pace-foot')).toContainText('$');
      }
      await expect(window.getByRole('table').locator('tbody tr').first()).toContainText(
        strings.lasts,
      );
      // Settled readings: no learning badge.
      await expect(page.locator('.np-badge')).toHaveCount(0);
      // Side by side, the same height.
      const [weekBox, windowBox] = [(await week.boundingBox())!, (await window.boundingBox())!];
      expect(Math.abs(weekBox.y - windowBox.y)).toBeLessThan(1);
      expect(Math.abs(weekBox.height - windowBox.height)).toBeLessThan(1);
      expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(4.5);
      await page.screenshot({ path: `${SCREENS}/pace-${theme}.png` });
      expect(panel.problems).toEqual([]);
    });
  }

  test('says the figures are rough while it is learning, and fits a narrow panel', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 420, height: 900 });
    const panel = await openPanel(page, 'dark');
    const data = readmeTimeline('7d');
    await panel.init({ ...data, pace: { ...data.pace!, learning: true } });
    await expect(page.locator('.np-badge')).toHaveCount(2);
    await expect(page.locator('.np-badge').first()).toHaveAttribute('title', strings.learningHint);
    const overflow = await page.evaluate(
      () =>
        document.getElementById('app')!.scrollWidth - document.getElementById('app')!.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    expect(panel.problems).toEqual([]);
  });

  test('is left out without plan limits', async ({ page }) => {
    const panel = await openPanel(page, 'dark');
    await panel.init({ ...readmeTimeline('7d'), pace: undefined });
    await expect(page.locator('.np-chart svg')).toBeVisible();
    await expect(page.getByRole('region', { name: strings.weekTitle })).toBeHidden();
    expect(panel.problems).toEqual([]);
  });
});
