import { expect, test } from '@playwright/test';
import { lowestTextContrast } from './contrast';
import { openPanel, strings } from './harness';
import { sampleTimeline } from './sampleTimeline';
import type { ThemeName } from './themes';
import type { TimeWindow } from '../../src/shared/protocol';

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
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, y, { steps: 5 });
  await expect(page.locator('.np-brush')).toBeVisible();
  await page.mouse.up();
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
