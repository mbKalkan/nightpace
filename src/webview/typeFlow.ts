// Tokens and API cost by type as two full-width stacked bars, one above the other, with a
// ribbon from each type's share of the tokens to its share of the cost: cache reads narrow from
// most of the tokens to a third of the cost, cache writes widen. The table beside it holds the
// numbers; pointing at a type here or there lights it up in both.
import type { PanelStrings } from '../shared/protocol';
import { svg } from './chart/svg';
import type { Formats } from './format';

export interface FlowPart {
  key: string;
  label: string;
  className: string;
  tokens: number;
  cost: number;
}

const BAR = 18;
const RIBBON = 56;
/** Room for the share labels above the first bar and below the second. */
const LABEL = 18;
/** Between the row names and the bars. */
const NAME_GAP = 12;
/** The surface between touching segments. */
const GAP = 2;
/** A share smaller than this, or a segment narrower than `LABEL_MIN_PX`, goes unlabeled. */
const LABEL_MIN_SHARE = 0.08;
const LABEL_MIN_PX = 34;

interface Segment {
  part: FlowPart;
  x: number;
  width: number;
  share: number;
}

export class TypeFlow {
  readonly element = document.createElement('div');
  private readonly tooltip = document.createElement('div');
  private parts: FlowPart[] = [];
  private root: SVGSVGElement | undefined;

  constructor(
    private readonly strings: PanelStrings,
    private readonly formats: Formats,
    /** The type pointed at, or none. */
    private readonly onPoint: (key: string | undefined) => void,
  ) {
    this.element.className = 'np-flow';
    this.tooltip.className = 'np-tooltip';
    this.tooltip.hidden = true;
    this.tooltip.setAttribute('aria-hidden', 'true');
    this.element.append(this.tooltip);
    new ResizeObserver(() => this.draw()).observe(this.element);
  }

  render(parts: FlowPart[]): void {
    this.parts = parts.filter((part) => part.tokens > 0 || part.cost > 0);
    this.draw();
  }

  /** Lights up one type and dims the others, or none. */
  highlight(key: string | undefined): void {
    const root = this.root;
    if (!root) return;
    root.classList.toggle('np-hovering', key !== undefined);
    for (const element of root.querySelectorAll('[data-key]')) {
      element.classList.toggle('np-active', element.getAttribute('data-key') === key);
    }
  }

  private draw(): void {
    const width = this.element.clientWidth;
    this.root?.remove();
    this.root = undefined;
    if (width === 0 || this.parts.length === 0) return;
    const s = this.strings;
    const height = LABEL + BAR + RIBBON + BAR + LABEL;
    const root = svg('svg', {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': s.flowLabel,
    });
    this.element.prepend(root);
    this.root = root;

    const top = LABEL;
    const bottom = LABEL + BAR + RIBBON;
    // The row names first: the bars start after the longer one.
    const names = [
      svg('text', { x: 0, y: top + BAR / 2 + 4, class: 'np-flow-name' }, s.tokens),
      svg('text', { x: 0, y: bottom + BAR / 2 + 4, class: 'np-flow-name' }, s.cost),
    ];
    root.append(...names);
    const left = Math.max(...names.map((name) => name.getComputedTextLength())) + NAME_GAP;
    const span = width - left;
    if (span < 80) return;

    const tokens = this.segments('tokens', left, span);
    const cost = this.segments('cost', left, span);
    const ribbons = svg('g');
    const bars = svg('g');
    const labels = svg('g');
    for (const part of this.parts) {
      const above = tokens.get(part.key);
      const below = cost.get(part.key);
      if (above && below) {
        const [y1, y2, middle] = [top + BAR, bottom, top + BAR + RIBBON / 2];
        const [a0, a1, b0, b1] = [above.x, above.x + above.width, below.x, below.x + below.width];
        ribbons.append(
          this.hit(
            svg('path', {
              class: `np-flow-ribbon ${part.className}`,
              d:
                `M${a0},${y1}C${a0},${middle} ${b0},${middle} ${b0},${y2}` +
                `L${b1},${y2}C${b1},${middle} ${a1},${middle} ${a1},${y1}Z`,
            }),
            part,
          ),
        );
      }
      for (const [segment, y, labelY] of [
        [above, top, top - 6],
        [below, bottom, bottom + BAR + 14],
      ] as const) {
        if (!segment) continue;
        bars.append(
          this.hit(
            svg('rect', {
              class: `np-flow-bar ${part.className}`,
              x: segment.x,
              y,
              width: Math.max(segment.width, 1),
              height: BAR,
              rx: 2,
            }),
            part,
          ),
        );
        if (segment.share >= LABEL_MIN_SHARE && segment.width >= LABEL_MIN_PX) {
          labels.append(
            svg(
              'text',
              {
                x: segment.x + segment.width / 2,
                y: labelY,
                'text-anchor': 'middle',
                class: 'np-flow-share',
                'data-key': part.key,
              },
              this.formats.share(segment.share),
            ),
          );
        }
      }
    }
    root.append(ribbons, bars, labels);
  }

  /** Each type's place in one bar, in the parts' order, with a gap between touching ones. */
  private segments(measure: 'tokens' | 'cost', left: number, span: number): Map<string, Segment> {
    const shown = this.parts.filter((part) => part[measure] > 0);
    const total = shown.reduce((sum, part) => sum + part[measure], 0);
    const room = span - GAP * (shown.length - 1);
    const segments = new Map<string, Segment>();
    let x = left;
    for (const part of shown) {
      const share = part[measure] / total;
      const width = share * room;
      segments.set(part.key, { part, x, width, share });
      x += width + GAP;
    }
    return segments;
  }

  /** A mark that tells what it is when pointed at. */
  private hit<T extends SVGElement>(element: T, part: FlowPart): T {
    element.setAttribute('data-key', part.key);
    element.addEventListener('pointerenter', () => {
      this.highlight(part.key);
      this.onPoint(part.key);
    });
    element.addEventListener('pointermove', (event) => this.showTooltip(part, event));
    element.addEventListener('pointerleave', () => {
      this.highlight(undefined);
      this.onPoint(undefined);
      this.tooltip.hidden = true;
    });
    return element;
  }

  private showTooltip(part: FlowPart, event: PointerEvent): void {
    const s = this.strings;
    const f = this.formats;
    const totals = this.parts.reduce(
      (sum, other) => ({ tokens: sum.tokens + other.tokens, cost: sum.cost + other.cost }),
      { tokens: 0, cost: 0 },
    );
    const title = document.createElement('div');
    title.className = 'np-tooltip-title';
    title.textContent = part.label;
    const rows = document.createElement('div');
    rows.className = 'np-tooltip-rows';
    for (const [name, value, share] of [
      [s.tokens, f.amount(part.tokens), totals.tokens > 0 ? part.tokens / totals.tokens : 0],
      [s.cost, f.money(part.cost), totals.cost > 0 ? part.cost / totals.cost : 0],
    ] as const) {
      const key = document.createElement('span');
      key.className = `np-tooltip-key ${part.className}`;
      const strong = document.createElement('strong');
      strong.textContent = value;
      const label = document.createElement('span');
      label.className = 'np-tooltip-label';
      label.textContent = `${name} · ${f.share(share)}`;
      rows.append(key, strong, label);
    }
    this.tooltip.replaceChildren(title, rows);
    this.tooltip.hidden = false;
    const box = this.element.getBoundingClientRect();
    const x = event.clientX - box.left;
    const width = this.tooltip.offsetWidth;
    this.tooltip.style.left = `${Math.max(0, x + 14 + width > box.width ? x - 14 - width : x + 14)}px`;
    this.tooltip.style.top = `${Math.max(0, event.clientY - box.top - 20)}px`;
  }
}
