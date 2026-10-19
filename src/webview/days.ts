// The weekly limit a day at a time over one quota week, a column a day counted from the reset:
// what each day used, read or estimated, and in this week what each day ahead can take for the
// week to last to its reset. A seventh of the limit a day is marked across. Each column says its
// value on its cap; pointing at it, or the arrow keys, says the rest.
import type { PanelStrings, WeekDay, WeekDays } from '../shared/protocol';
import { columnPath, svg } from './chart/svg';
import { valueTicks } from './chart/ticks';
import type { Formats } from './format';

const DAY = 86_400_000;
const LEFT = 44;
const RIGHT = 44;
/** Room for the legend above the plot. */
const TOP = 34;
const BOTTOM = 24;
/** A seventh of the limit a day spends it evenly over the week. */
const EVEN = 100 / 7;
/** Space between the part of today used and the part it can take, as between stacked segments. */
const GAP = 2;

export class DayCard {
  readonly element = document.createElement('section');
  private readonly span = document.createElement('span');
  private readonly place = document.createElement('div');
  private readonly tooltip = document.createElement('div');
  private readonly live = document.createElement('div');
  private readonly footnote = document.createElement('p');
  private data: WeekDays | undefined;
  private root: SVGSVGElement | undefined;
  private index: number | undefined;
  private centers: number[] = [];
  private drawn = { width: 0, height: 0 };

  constructor(
    private readonly strings: PanelStrings,
    private readonly formats: Formats,
  ) {
    this.element.className = 'np-card np-days';
    this.element.setAttribute('aria-labelledby', 'np-days-title');
    const header = document.createElement('div');
    header.className = 'np-card-header';
    const title = document.createElement('h2');
    title.id = 'np-days-title';
    title.className = 'np-card-title';
    title.textContent = strings.daysTitle;
    this.span.className = 'np-note-text';
    header.append(title, this.span);

    this.place.className = 'np-days-place';
    this.place.tabIndex = 0;
    this.place.setAttribute('role', 'group');
    this.place.setAttribute('aria-label', strings.daysTitle);
    this.tooltip.className = 'np-day-tooltip';
    this.tooltip.setAttribute('aria-hidden', 'true');
    this.tooltip.hidden = true;
    this.live.className = 'np-visually-hidden';
    this.live.setAttribute('aria-live', 'polite');
    this.place.append(this.tooltip, this.live);
    this.place.addEventListener('keydown', (event) => this.key(event));
    this.place.addEventListener('blur', () => this.hover(undefined));
    this.place.addEventListener('pointerleave', () => {
      if (document.activeElement !== this.place) this.hover(undefined);
    });
    this.footnote.className = 'np-note-text np-days-note';
    this.element.append(header, this.place, this.footnote);

    // Drawn to the size of its place, which the card around it stretches.
    new ResizeObserver(() => {
      const { clientWidth: width, clientHeight: height } = this.place;
      if (width !== this.drawn.width || height !== this.drawn.height) this.draw();
    }).observe(this.place);
  }

  render(data: WeekDays | undefined): void {
    this.data = data;
    this.span.textContent = data ? this.formats.window(data.week.from, data.week.to) : '';
    this.footnote.textContent = data
      ? this.strings.daysNote.replace('{0}', this.formats.clock(data.week.from))
      : '';
    this.footnote.hidden = !data;
    this.draw();
  }

  private draw(): void {
    const width = this.place.clientWidth;
    const height = this.place.clientHeight;
    this.drawn = { width, height };
    this.root?.remove();
    this.root = undefined;
    if (width === 0 || height === 0) return;
    const root = svg('svg', { width, height, 'aria-hidden': 'true' });
    this.root = root;
    this.place.prepend(root);
    const data = this.data;
    if (!data) {
      root.append(
        svg(
          'text',
          { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'np-axis-label' },
          this.strings.noQuotaYet,
        ),
      );
      return;
    }
    const f = this.formats;
    const { days } = data;
    const plotRight = width - RIGHT;
    const plotBottom = height - BOTTOM;
    const ticks = valueTicks(
      Math.max(EVEN, ...days.map((day) => (day.used ?? 0) + (day.canTake ?? 0))) * 1.15,
      3,
    );
    const top = ticks[ticks.length - 1];
    const y = (value: number) => plotBottom - (value / top) * (plotBottom - TOP);
    const slot = (plotRight - LEFT) / days.length;
    const barWidth = Math.max(4, Math.min(24, slot - 4));

    this.legend(root, data);
    for (const tick of ticks) {
      root.append(
        svg('line', {
          class: tick === 0 ? 'np-baseline' : 'np-grid',
          x1: LEFT,
          x2: plotRight,
          y1: y(tick),
          y2: y(tick),
        }),
        svg(
          'text',
          { class: 'np-axis-label', x: LEFT - 8, y: y(tick) + 4, 'text-anchor': 'end' },
          `${tick}%`,
        ),
      );
    }
    root.append(
      svg('line', { class: 'np-even', x1: LEFT, x2: plotRight, y1: y(EVEN), y2: y(EVEN) }),
      svg('text', { class: 'np-axis-label', x: plotRight + 6, y: y(EVEN) + 4 }, f.fine(EVEN)),
    );

    // In this week, the first day that can still take some is today.
    const today = days.findIndex((day) => day.canTake !== undefined);
    this.centers = days.map((_, i) => LEFT + slot * (i + 0.5));
    days.forEach((day, i) => {
      const center = this.centers[i];
      const left = center - barWidth / 2;
      const column = svg('g', { class: 'np-col', 'data-index': i });
      const used = day.used ?? 0;
      const ahead = day.canTake ?? 0;
      const usedHeight = y(0) - y(used);
      const aheadHeight = y(0) - y(ahead);
      if (usedHeight >= 0.5) {
        column.append(
          svg('path', {
            d: columnPath(left, y(used), barWidth, Math.max(1, usedHeight), aheadHeight < 1),
            class: `np-day-bar np-s-week${day.estimated ? ' np-day-estimated' : ''}`,
          }),
        );
      }
      // What the rest of the day can take sits on what it used, a gap apart.
      const base = usedHeight >= 0.5 ? y(used) - GAP : y(0);
      if (aheadHeight >= 1) {
        column.append(
          svg('path', {
            d: columnPath(left, base - aheadHeight, barWidth, aheadHeight, true),
            class: 'np-day-budget',
          }),
        );
      }
      // The value on the cap: what the day used, or for a day ahead what it can take. Today's
      // use sits on its own part, within what it can still take where that has room.
      const value = day.used ?? day.canTake;
      if (value !== undefined) {
        const room = day.used !== undefined && aheadHeight >= 20;
        const capTop = aheadHeight >= 1 && !room ? base - aheadHeight : y(used);
        column.append(
          svg(
            'text',
            {
              class: `np-day-label${day.used === undefined ? ' np-day-ahead' : ''}${room ? ' np-day-inside' : ''}`,
              x: center,
              y: capTop - 6,
              'text-anchor': 'middle',
            },
            f.fine(value),
          ),
        );
      }
      root.append(column);
      // Under the columns, never dimmed with them.
      root.append(
        svg(
          'text',
          {
            class: `np-axis-label${i === today ? ' np-day-today' : ''}`,
            x: center,
            y: height - 6,
            'text-anchor': 'middle',
          },
          f.tick(day.from + DAY / 2, DAY),
        ),
      );
    });
    // Each day's whole slot takes the pointer, not only its column.
    days.forEach((_, i) => {
      const hit = svg('rect', {
        class: 'np-day-hit',
        x: LEFT + slot * i,
        y: TOP,
        width: slot,
        height: plotBottom - TOP,
      });
      hit.addEventListener('pointerenter', () => this.hover(i));
      root.append(hit);
    });
    if (this.index !== undefined) this.hover(this.index);
  }

  /** The keys of what the chart shows, left to right above the plot. */
  private legend(root: SVGSVGElement, data: WeekDays): void {
    const s = this.strings;
    const keys: Array<{ className: string; label: string; line?: boolean }> = [
      ...(data.days.some((day) => !day.estimated && day.used !== undefined)
        ? [{ className: 'np-day-bar np-s-week', label: s.used }]
        : []),
      ...(data.days.some((day) => day.estimated && day.used !== undefined)
        ? [{ className: 'np-day-bar np-s-week np-day-estimated', label: s.estimated }]
        : []),
      ...(data.days.some((day) => (day.canTake ?? 0) > 0)
        ? [{ className: 'np-day-budget', label: s.budgetToLast }]
        : []),
      { className: 'np-even', label: s.evenSplit, line: true },
    ];
    const y = 14;
    let cursor = LEFT;
    for (const key of keys) {
      root.append(
        key.line
          ? svg('line', { class: key.className, x1: cursor, x2: cursor + 14, y1: y - 4, y2: y - 4 })
          : svg('rect', {
              class: key.className,
              x: cursor,
              y: y - 9,
              width: 10,
              height: 10,
              rx: 2,
            }),
      );
      const label = svg(
        'text',
        { class: 'np-legend-text', x: cursor + (key.line ? 19 : 15), y },
        key.label,
      );
      root.append(label);
      cursor += (key.line ? 19 : 15) + label.getComputedTextLength() + 14;
    }
  }

  private key(event: KeyboardEvent): void {
    const data = this.data;
    if (!data) return;
    const last = data.days.length - 1;
    let next: number | undefined;
    if (event.key === 'Escape') {
      this.hover(undefined);
      return;
    }
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const move = event.key === 'ArrowLeft' ? -1 : 1;
      // From nowhere, to today, or the last day of a week gone by.
      const today = data.days.findIndex((day) => day.canTake !== undefined);
      next =
        this.index === undefined
          ? today >= 0
            ? today
            : last
          : Math.min(Math.max(this.index + move, 0), last);
    } else return;
    event.preventDefault();
    this.hover(next);
    this.live.textContent = this.describe(data.days[next]).join(', ');
  }

  /** Points at a day, or at nothing. */
  private hover(index: number | undefined): void {
    this.index = index;
    const root = this.root;
    const data = this.data;
    if (!root || !data) return;
    root.classList.toggle('np-hovering', index !== undefined);
    for (const column of root.querySelectorAll('.np-col')) {
      column.classList.toggle('np-active', Number(column.getAttribute('data-index')) === index);
    }
    if (index === undefined) {
      this.tooltip.hidden = true;
      return;
    }
    const day = data.days[index];
    const title = document.createElement('div');
    title.className = 'np-tooltip-title';
    title.textContent = this.formats.window(day.from, day.to);
    const list = document.createElement('div');
    list.className = 'np-tooltip-rows';
    for (const [value, label, className] of this.rows(day)) {
      const key = document.createElement('span');
      key.className = `np-tooltip-key ${className}`;
      const strong = document.createElement('strong');
      strong.textContent = value;
      const name = document.createElement('span');
      name.className = 'np-tooltip-label';
      name.textContent = label;
      list.append(key, strong, name);
    }
    this.tooltip.replaceChildren(title, list);
    this.tooltip.hidden = false;
    const center = this.centers[index];
    const width = this.tooltip.offsetWidth;
    const left = center + 14 + width > this.drawn.width ? center - 14 - width : center + 14;
    this.tooltip.style.left = `${Math.max(0, left)}px`;
    this.tooltip.style.top = `${TOP}px`;
  }

  /** What a day used, can take and cost, as rows of [value, label, series class]. */
  private rows(day: WeekDay): Array<[string, string, string]> {
    const s = this.strings;
    const f = this.formats;
    const rows: Array<[string, string, string]> = [];
    if (day.used !== undefined) {
      const label = day.estimated ? s.estimatedLabel.replace('{0}', s.used) : s.used;
      rows.push([f.fine(day.used), label, 'np-s-week']);
    }
    if (day.canTake !== undefined) rows.push([f.fine(day.canTake), s.budgetToLast, '']);
    if (day.cost > 0) rows.push([f.money(day.cost), s.cost, '']);
    return rows;
  }

  private describe(day: WeekDay): string[] {
    return [
      this.formats.window(day.from, day.to),
      ...this.rows(day).map(([value, label]) => `${label} ${value}`),
    ];
  }
}
