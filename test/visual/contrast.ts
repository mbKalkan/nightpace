import type { Page } from '@playwright/test';

/**
 * Lowest WCAG contrast between any visible text in `root` and the opaque background behind it,
 * measured from computed styles in the page. Translucent text is blended over its background.
 */
export const lowestTextContrast = (page: Page, root = '#app') =>
  page.evaluate((root) => {
    const parse = (value: string) => {
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(value);
      return m ? { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] } : undefined;
    };
    const luminance = ([r, g, b]: number[]) => {
      const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    // Translucent backgrounds (VS Code's toggle and hover colors) are blended over the ones
    // behind them, down to the first opaque one.
    const backgroundOf = (el: Element | null): number[] => {
      const layers: Array<{ rgb: number[]; a: number }> = [];
      for (let node = el; node; node = node.parentElement) {
        const bg = parse(getComputedStyle(node).backgroundColor);
        if (!bg || bg.a === 0) continue;
        layers.push(bg);
        if (bg.a >= 1) break;
      }
      let rgb = [255, 255, 255];
      for (const layer of layers.reverse()) {
        rgb = rgb.map((c, i) => layer.rgb[i] * layer.a + c * (1 - layer.a));
      }
      return rgb;
    };
    let lowest = Infinity;
    const walker = document.createTreeWalker(
      document.querySelector(root) as Node,
      NodeFilter.SHOW_TEXT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || el.tagName === 'STYLE' || !node.textContent?.trim()) continue;
      if (!el.checkVisibility()) continue;
      // SVG text is painted with its fill, not its color.
      const style = getComputedStyle(el);
      const fg = parse(el instanceof SVGElement ? style.fill : style.color);
      if (!fg) continue;
      const bg = backgroundOf(el);
      const text = fg.rgb.map((c, i) => c * fg.a + bg[i] * (1 - fg.a));
      const [a, b] = [luminance(text), luminance(bg)].sort((x, y) => y - x);
      lowest = Math.min(lowest, (a + 0.05) / (b + 0.05));
    }
    return lowest;
  }, root);
