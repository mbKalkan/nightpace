import { expect, test } from '@playwright/test';
import { lowestTextContrast } from './contrast';
import { openPanel, strings } from './harness';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

for (const theme of ['dark', 'light', 'hcDark', 'hcLight'] as ThemeName[]) {
  test.describe(`${theme} theme`, () => {
    test('shows the panel with its privacy note', async ({ page }) => {
      const panel = await openPanel(page, theme);
      await panel.init();

      await expect(page.getByRole('main', { name: strings.title })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(strings.title);
      await expect(page.locator('.np-privacy')).toHaveText(strings.privacy);
      // WCAG AA for every text, AAA in the dark high contrast theme (VS Code's own secondary
      // text in light high contrast is AA).
      expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(theme === 'hcDark' ? 7 : 4.5);
      await page.screenshot({ path: `${SCREENS}/panel-${theme}.png` });
      expect(panel.problems).toEqual([]);
    });
  });
}

test('tells the host it is ready, once', async ({ page }) => {
  const panel = await openPanel(page, 'dark');
  expect(await panel.sent()).toEqual([{ type: 'ready' }]);
});
