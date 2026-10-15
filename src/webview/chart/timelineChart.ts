// The timeline: three lanes on one time axis. Plan quota (5-hour and weekly, as observed), the
// sessions working at once, and API cost or tokens by model, effort level or token type. Each lane has its own value axis;
// no lane ever carries two (no dual axes). Colors come from CSS, so a theme change restyles it.
// Dragging across it, Ctrl + scroll (or a pinch) and the plus and minus keys ask to zoom; the
// panel decides what that means for the range.
import type {
  PanelStrings,
  QuotaPoint,
  TimelineData,
  TimeWindow,
  TokenMeasure,
  TokenSplit,
} from '../../shared/protocol';
import { coversExtent, scaleWindow, shiftWindow } from '../../shared/window';
import type { Formats } from '../format';
import { tokenSeries } from './series';
import { columnPath, svg } from './svg';
import { timeTicks, valueTicks } from './ticks';

const LEFT = 48;
const RIGHT = 56;
const TITLE = 26;
const LANE_GAP = 18;
const AXIS = 24;
const HEIGHTS = { quota: 140, sessions: 64, tokens: 120 };
/** A drag shorter than this is a click, not a zoom. */
const MIN_DRAG_PX = 6;
/** Polling is hourly when idle: a longer silence means Nightpace wasn't running. */
const QUOTA_GAP_MS = 75 * 60_000;
const QUOTA_SERIES = [
  { key: 'fiveHour', reset: 'fiveHourReset', className: 'np-s-five' },
  { key: 'weekly', reset: 'weeklyReset', className: 'np-s-week' },
] as const;

interface Lane {
  top: number;
  height: number;
}

export class TimelineChart {
  readonly element = document.createElement('div');
  private readonly tooltip = document.createElement('div');
  private readonly live = document.createElement('div');
  private data: TimelineData | undefined;
  private width = 0;
  private svgRoot: SVGSVGElement | undefined;
  private index: number | undefined;
  private x: (time: number) => number = () => 0;
  private plotRight = 0;
  /** What the token lane's columns are split by; the panel sets it before rendering. */
  split: TokenSplit = 'model';
  /** What the token lane measures; the panel sets it before rendering. */
  measure: TokenMeasure = 'cost';
  /** Where a drag to zoom started, as a client x coordinate. */
  private dragFrom: number | undefined;

  constructor(
    private readonly strings: PanelStrings,
    private readonly formats: Formats,
    /** Asks for a window to show, or the whole range without one. */
    private readonly onZoom: (window: TimeWindow | undefined) => void,
  ) {
    this.element.className = 'np-chart';
    this.element.tabIndex = 0;
    this.element.setAttribute('role', 'group');
    this.element.setAttribute('aria-label', strings.chartLabel);
    this.tooltip.className = 'np-tooltip';
    this.tooltip.setAttribute('aria-hidden', 'true');
    this.tooltip.hidden = true;
    this.live.className = 'np-visually-hidden';
    this.live.setAttribute('aria-live', 'polite');
    this.element.append(this.tooltip, this.live);
    this.element.addEventListener('keydown', (event) => this.key(event));
    this.element.addEventListener('blur', () => this.hover(undefined));
  }

  /** Draws the timeline, or the part of it within `window` while the host zooms. */
  render(data: TimelineData, width: number, window?: TimeWindow): void {
    // The crosshair stays at the same time, not at the same column.
    const previous = this.data;
    const hovered =
      previous && this.index !== undefined
        ? previous.buckets[this.index].start + previous.bucketMs / 2
        : undefined;
    this.data = window ? viewOf(data, window) : data;
    this.width = Math.max(width, 320);
    this.svgRoot = this.draw(this.data, this.width);
    if (hovered !== undefined) this.hover(this.bucketAt(hovered));
  }

  private draw(data: TimelineData, width: number): SVGSVGElement {
    const plotRight = width - RIGHT;
    this.plotRight = plotRight;
    const span = data.to - data.from;
    const x = (time: number) => LEFT + ((time - data.from) / span) * (plotRight - LEFT);
    this.x = x;

    const quota: Lane = { top: TITLE, height: HEIGHTS.quota };
    const sessions: Lane = {
      top: quota.top + quota.height + LANE_GAP + TITLE,
      height: HEIGHTS.sessions,
    };
    const tokens: Lane = {
      top: sessions.top + sessions.height + LANE_GAP + TITLE,
      height: HEIGHTS.tokens,
    };
    const height = tokens.top + tokens.height + AXIS;
    const root = svg('svg', {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      'aria-hidden': 'true',
    });
    const clip = svg('clipPath', { id: 'np-plot-clip' });
    clip.append(svg('rect', { x: LEFT, y: 0, width: plotRight - LEFT, height }));
    const defs = svg('defs');
    defs.append(clip);
    root.append(defs);
    // In the document before drawing: legends are laid out by measuring their text.
    this.svgRoot?.remove();
    this.element.prepend(root);

    this.drawTimeGrid(root, data, x, quota.top, tokens.top + tokens.height);
    this.drawQuota(root, data, quota, x, plotRight);
    this.drawSessions(root, data, sessions, x, plotRight);
    this.drawTokens(root, data, tokens, x, plotRight);

    const hit = svg('rect', {
      class: 'np-hit',
      x: LEFT,
      y: quota.top,
      width: plotRight - LEFT,
      height: tokens.top + tokens.height - quota.top,
    });
    hit.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      hit.setPointerCapture(event.pointerId);
      this.dragFrom = event.clientX;
    });
    hit.addEventListener('pointermove', (event) => {
      if (this.dragFrom !== undefined && Math.abs(event.clientX - this.dragFrom) >= MIN_DRAG_PX) {
        this.hover(undefined);
        this.drawBrush(root, this.dragFrom, event.clientX, quota.top, tokens.top + tokens.height);
        return;
      }
      this.hover(this.bucketAt(this.timeAt(event.clientX)));
    });
    hit.addEventListener('pointerup', (event) => this.endDrag(event.clientX));
    hit.addEventListener('pointercancel', () => this.endDrag(undefined));
    hit.addEventListener('pointerleave', () => {
      if (document.activeElement !== this.element) this.hover(undefined);
    });
    hit.addEventListener('wheel', (event) => this.wheel(event), { passive: false });
    root.append(
      svg('line', {
        class: 'np-crosshair',
        visibility: 'hidden',
        y1: quota.top,
        y2: tokens.top + tokens.height,
      }),
      hit,
    );
    return root;
  }

  private drawTimeGrid(
    root: SVGSVGElement,
    data: TimelineData,
    x: (time: number) => number,
    top: number,
    bottom: number,
  ): void {
    const { times, step } = timeTicks(
      data.from,
      data.to,
      Math.max(3, Math.floor(this.width / 110)),
    );
    const group = svg('g', { class: 'np-axis' });
    for (const time of times) {
      group.append(
        svg('line', { class: 'np-grid', x1: x(time), x2: x(time), y1: top, y2: bottom }),
        svg(
          'text',
          { x: x(time), y: bottom + 16, 'text-anchor': 'middle' },
          this.formats.tick(time, step),
        ),
      );
    }
    root.append(group);
  }

  /** A lane's title, with a legend of keys after it, and a note at the right end. */
  private laneTitle(
    root: SVGSVGElement,
    lane: Lane,
    title: string,
    keys: Array<{ className: string; label: string; shape: 'line' | 'rect' }>,
    note?: string,
  ): void {
    const y = lane.top - 9;
    const group = svg('g', { class: 'np-lane-title' });
    const heading = svg('text', { x: LEFT, y, class: 'np-title-text' }, title);
    group.append(heading);
    root.append(group);
    // Laid out after the title is in the document, so its width is known.
    let cursor = LEFT + heading.getComputedTextLength() + 18;
    for (const key of keys) {
      const mark =
        key.shape === 'line'
          ? svg('line', {
              class: `np-key ${key.className}`,
              x1: cursor,
              x2: cursor + 14,
              y1: y - 4,
              y2: y - 4,
            })
          : svg('rect', {
              class: `np-key-rect ${key.className}`,
              x: cursor,
              y: y - 9,
              width: 10,
              height: 10,
              rx: 2,
            });
      const label = svg(
        'text',
        { x: cursor + (key.shape === 'line' ? 19 : 15), y, class: 'np-legend-text' },
        key.label,
      );
      group.append(mark, label);
      cursor += (key.shape === 'line' ? 19 : 15) + label.getComputedTextLength() + 14;
    }
    if (note) {
      const text = svg(
        'text',
        { x: this.width - RIGHT, y, 'text-anchor': 'end', class: 'np-note' },
        note,
      );
      group.append(text);
      // Where the legend leaves no room, the note moves into the top of the plot.
      if (this.width - RIGHT - text.getComputedTextLength() < cursor) {
        text.setAttribute('x', String(LEFT + 8));
        text.setAttribute('y', String(lane.top + 14));
        text.setAttribute('text-anchor', 'start');
      }
    }
  }

  private valueAxis(
    root: SVGSVGElement,
    lane: Lane,
    ticks: number[],
    label: (value: number) => string,
    plotRight: number,
  ): (value: number) => number {
    const max = ticks[ticks.length - 1];
    const y = (value: number) => lane.top + lane.height - (value / max) * lane.height;
    const group = svg('g', { class: 'np-axis' });
    for (const tick of ticks) {
      group.append(
        svg('line', {
          class: tick === 0 ? 'np-baseline' : 'np-grid',
          x1: LEFT,
          x2: plotRight,
          y1: y(tick),
          y2: y(tick),
        }),
        svg('text', { x: LEFT - 8, y: y(tick) + 4, 'text-anchor': 'end' }, label(tick)),
      );
    }
    root.append(group);
    return y;
  }

  private drawQuota(
    root: SVGSVGElement,
    data: TimelineData,
    lane: Lane,
    x: (time: number) => number,
    plotRight: number,
  ): void {
    const s = this.strings;
    const recording = data.recordingSince;
    const note =
      recording === undefined
        ? undefined
        : recording > data.from
          ? s.quotaSince.replace('{0}', this.formats.dayClock(recording))
          : undefined;
    this.laneTitle(
      root,
      lane,
      s.quotaLane,
      [
        { className: 'np-s-five', label: s.fiveHour, shape: 'line' },
        { className: 'np-s-week', label: s.weekly, shape: 'line' },
      ],
      note,
    );
    const y = this.valueAxis(root, lane, [0, 25, 50, 75, 100], (v) => `${v}%`, plotRight);
    if (data.quota.length === 0) {
      root.append(
        svg(
          'text',
          {
            x: (LEFT + plotRight) / 2,
            y: lane.top + lane.height / 2,
            'text-anchor': 'middle',
            class: 'np-note',
          },
          s.noQuotaYet,
        ),
      );
      return;
    }
    const ends: Array<{ y: number; text: string; className: string }> = [];
    for (const series of QUOTA_SERIES) {
      const d = quotaPath(data.quota, series.key, series.reset, x, y);
      if (!d) continue;
      root.append(
        svg('path', { d, class: `np-line ${series.className}`, 'clip-path': 'url(#np-plot-clip)' }),
      );
      // The latest reading gets a dot and a label, when the window reaches the present.
      const last = [...data.quota]
        .reverse()
        .find((point) => point[series.key] !== undefined && point.time <= data.to);
      if (last && last.time >= data.from && data.to >= data.extent.to) {
        const value = last[series.key]!;
        root.append(
          svg('circle', {
            cx: x(last.time),
            cy: y(value),
            r: 4,
            class: `np-dot ${series.className}`,
          }),
        );
        ends.push({ y: y(value), text: this.formats.percent(value), className: series.className });
      }
    }
    // End labels that would collide are left to the legend and the tooltip.
    const apart = ends.length < 2 || Math.abs(ends[0].y - ends[1].y) >= 14;
    for (const end of apart ? ends : ends.slice(0, 1)) {
      root.append(
        svg('text', { x: plotRight + 10, y: end.y + 4, class: 'np-end-label' }, end.text),
      );
    }
  }

  private drawSessions(
    root: SVGSVGElement,
    data: TimelineData,
    lane: Lane,
    x: (time: number) => number,
    plotRight: number,
  ): void {
    this.laneTitle(root, lane, this.strings.sessionsLane, []);
    const max = Math.max(1, ...data.sessions.map((step) => step.count));
    const ticks =
      max <= 4 ? Array.from({ length: max + 1 }, (_, i) => i) : valueTicks(max, 2).map(Math.round);
    const y = this.valueAxis(root, lane, ticks, String, plotRight);
    let line = '';
    data.sessions.forEach((step, i) => {
      const x1 = x(step.time);
      const x2 = x(data.sessions[i + 1]?.time ?? data.to);
      line += `${i === 0 ? 'M' : 'L'}${x1},${y(step.count)}H${x2}`;
    });
    if (!line) return;
    const base = y(0);
    const area = `${line}V${base}H${x(data.sessions[0].time)}Z`;
    root.append(
      svg('path', { d: area, class: 'np-area np-s-sessions', 'clip-path': 'url(#np-plot-clip)' }),
      svg('path', { d: line, class: 'np-line np-s-sessions', 'clip-path': 'url(#np-plot-clip)' }),
    );
  }

  private drawTokens(
    root: SVGSVGElement,
    data: TimelineData,
    lane: Lane,
    x: (time: number) => number,
    plotRight: number,
  ): void {
    const s = this.strings;
    const series = tokenSeries(data, this.split, this.measure, s);
    const totals = data.buckets.map((bucket) => bucket[this.measure].total);
    const sum = totals.reduce((a, b) => a + b, 0);
    this.laneTitle(
      root,
      lane,
      s.tokenLanes[this.measure][this.split],
      series.map(({ className, label }) => ({ className, label, shape: 'rect' as const })),
      sum > 0 ? s.periodTotal.replace('{0}', this.amount(sum)) : undefined,
    );
    const ticks = valueTicks(Math.max(...totals, 0), 2);
    const label =
      this.measure === 'cost'
        ? this.formats.axisMoney(ticks[ticks.length - 1])
        : (v: number) => this.formats.amount(v);
    const y = this.valueAxis(root, lane, ticks, label, plotRight);
    if (totals.every((value) => value === 0)) {
      root.append(
        svg(
          'text',
          {
            x: (LEFT + plotRight) / 2,
            y: lane.top + lane.height / 2,
            'text-anchor': 'middle',
            class: 'np-note',
          },
          s.empty,
        ),
      );
      return;
    }
    const slot = x(data.from + data.bucketMs) - x(data.from);
    const width = Math.max(2, Math.min(24, slot - 4));
    const scale = lane.height / ticks[ticks.length - 1];
    const columns = svg('g', { class: 'np-columns', 'clip-path': 'url(#np-plot-clip)' });
    data.buckets.forEach((bucket, index) => {
      const left = x(bucket.start) + (slot - width) / 2;
      if (left + width > plotRight + 1) return;
      const group = svg('g', { class: 'np-col', 'data-index': index });
      let base = y(0);
      const drawn = series.filter((item) => item.value(bucket) * scale >= 0.5);
      drawn.forEach((item, i) => {
        if (i > 0) base -= 2; // the surface gap between stacked segments
        const height = Math.max(1, item.value(bucket) * scale - (i > 0 ? 2 : 0));
        group.append(
          svg('path', {
            d: columnPath(left, base - height, width, height, i === drawn.length - 1),
            class: `np-bar ${item.className}`,
          }),
        );
        base -= height;
      });
      columns.append(group);
    });
    root.append(columns);
  }

  private bucketAt(time: number): number | undefined {
    const data = this.data;
    if (!data || data.buckets.length === 0) return undefined;
    const index = Math.floor((time - data.buckets[0].start) / data.bucketMs);
    return Math.min(Math.max(index, 0), data.buckets.length - 1);
  }

  /** The time under a client x coordinate, within the window shown. */
  private timeAt(clientX: number): number {
    const data = this.data!;
    const box = this.svgRoot!.getBoundingClientRect();
    const share = (clientX - box.left - LEFT) / (this.plotRight - LEFT);
    return data.from + Math.min(Math.max(share, 0), 1) * (data.to - data.from);
  }

  private get window(): TimeWindow {
    return { from: this.data!.from, to: this.data!.to };
  }

  private drawBrush(
    root: SVGSVGElement,
    from: number,
    to: number,
    top: number,
    bottom: number,
  ): void {
    const box = root.getBoundingClientRect();
    const left = Math.max(Math.min(from, to) - box.left, LEFT);
    const right = Math.min(Math.max(from, to) - box.left, this.plotRight);
    let brush = root.querySelector('.np-brush');
    if (!brush) {
      brush = svg('rect', { class: 'np-brush', y: top, height: bottom - top });
      root.querySelector('.np-crosshair')!.before(brush);
    }
    brush.setAttribute('x', String(left));
    brush.setAttribute('width', String(Math.max(right - left, 0)));
  }

  private endDrag(clientX: number | undefined): void {
    const from = this.dragFrom;
    this.dragFrom = undefined;
    this.svgRoot?.querySelector('.np-brush')?.remove();
    if (from === undefined || clientX === undefined || Math.abs(clientX - from) < MIN_DRAG_PX)
      return;
    const [a, b] = [this.timeAt(from), this.timeAt(clientX)];
    this.onZoom({ from: Math.min(a, b), to: Math.max(a, b) });
  }

  /** Ctrl + scroll (a pinch on a touchpad) zooms around the pointer; sideways scroll pans. */
  private wheel(event: WheelEvent): void {
    const data = this.data;
    if (!data) return;
    if (event.ctrlKey) {
      event.preventDefault();
      const exponent =
        event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 0.05 : 0.002);
      const factor = Math.exp(Math.min(Math.max(exponent, -0.7), 0.7));
      this.onZoom(scaleWindow(this.window, factor, this.timeAt(event.clientX)));
      return;
    }
    const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    if (coversExtent(this.window, data.extent) || !(sideways || event.shiftKey)) return;
    event.preventDefault();
    const pixels = sideways ? event.deltaX : event.deltaY;
    const perPixel = (data.to - data.from) / (this.plotRight - LEFT);
    this.onZoom(shiftWindow(this.window, pixels * perPixel));
  }

  /** Plus and minus zoom around the crosshair, or the middle; zero shows the whole range. */
  private zoomKey(key: string): boolean {
    const data = this.data!;
    const center =
      this.index !== undefined
        ? data.buckets[this.index].start + data.bucketMs / 2
        : (data.from + data.to) / 2;
    if (key === '+' || key === '=') this.onZoom(scaleWindow(this.window, 0.5, center));
    else if (key === '-' || key === '_') this.onZoom(scaleWindow(this.window, 2, center));
    else if (key === '0') this.onZoom(undefined);
    else return false;
    return true;
  }

  private key(event: KeyboardEvent): void {
    const data = this.data;
    if (!data || data.buckets.length === 0) return;
    if (this.zoomKey(event.key)) {
      event.preventDefault();
      return;
    }
    const last = data.buckets.length - 1;
    const current = this.index ?? last;
    const next =
      event.key === 'ArrowLeft'
        ? Math.max(current - (this.index === undefined ? 0 : 1), 0)
        : event.key === 'ArrowRight'
          ? Math.min(current + (this.index === undefined ? 0 : 1), last)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : undefined;
    if (event.key === 'Escape') {
      this.hover(undefined);
      return;
    }
    if (next === undefined) return;
    event.preventDefault();
    this.hover(next);
    this.live.textContent = this.describe(next).join(', ');
  }

  private hover(index: number | undefined): void {
    this.index = index;
    const root = this.svgRoot;
    const data = this.data;
    if (!root || !data) return;
    root.classList.toggle('np-hovering', index !== undefined);
    for (const column of root.querySelectorAll('.np-col')) {
      column.classList.toggle('np-active', Number(column.getAttribute('data-index')) === index);
    }
    const crosshair = root.querySelector('.np-crosshair');
    if (index === undefined) {
      this.tooltip.hidden = true;
      crosshair?.setAttribute('visibility', 'hidden');
      return;
    }
    const bucket = data.buckets[index];
    const center = this.x(Math.min(bucket.start + data.bucketMs / 2, data.to));
    crosshair?.setAttribute('x1', String(center));
    crosshair?.setAttribute('x2', String(center));
    crosshair?.setAttribute('visibility', 'visible');
    this.fillTooltip(index);
    this.tooltip.hidden = false;
    const width = this.tooltip.offsetWidth;
    const left = center + 14 + width > this.width ? center - 14 - width : center + 14;
    this.tooltip.style.left = `${Math.max(0, left)}px`;
    this.tooltip.style.top = `${TITLE}px`;
  }

  /** The values at a bucket, as rows of [value, label, series class]. */
  private rows(index: number): Array<[string, string, string]> {
    const data = this.data!;
    const s = this.strings;
    const bucket = data.buckets[index];
    const end = Math.min(bucket.start + data.bucketMs, data.to);
    const quota = quotaAt(data.quota, end);
    const rows: Array<[string, string, string]> = [];
    if (quota?.fiveHour !== undefined)
      rows.push([this.formats.percent(quota.fiveHour), s.fiveHour, 'np-s-five']);
    if (quota?.weekly !== undefined)
      rows.push([this.formats.percent(quota.weekly), s.weekly, 'np-s-week']);
    rows.push([String(bucket.maxSessions), s.sessions, 'np-s-sessions']);
    for (const { value, label, className } of tokenSeries(data, this.split, this.measure, s)) {
      const amount = value(bucket);
      if (amount) rows.push([this.amount(amount), label, className]);
    }
    // Both totals, whichever the lane shows.
    if (bucket.requests > 0) {
      rows.push([this.formats.money(bucket.cost.total), s.cost, '']);
      rows.push([this.formats.amount(bucket.tokens.total), s.tokens, '']);
    }
    rows.push([String(bucket.requests), s.requests, '']);
    return rows;
  }

  /** An amount in the lane's measure. */
  private amount(value: number): string {
    return this.measure === 'cost' ? this.formats.money(value) : this.formats.amount(value);
  }

  private heading(index: number): string {
    const data = this.data!;
    const bucket = data.buckets[index];
    const end = Math.min(bucket.start + data.bucketMs, data.to);
    // Within about a day the hour says enough; the panel shows the date of a zoomed window.
    const day = data.to - data.from > 26 * 3_600_000;
    const start = day ? this.formats.dayClock(bucket.start) : this.formats.clock(bucket.start);
    // A column that ends on another day names that day too.
    const nextDay = new Date(end).toDateString() !== new Date(bucket.start).toDateString();
    const finish = day && nextDay ? this.formats.dayClock(end) : this.formats.clock(end);
    return `${start} – ${finish}`;
  }

  private describe(index: number): string[] {
    return [this.heading(index), ...this.rows(index).map(([value, label]) => `${label} ${value}`)];
  }

  private fillTooltip(index: number): void {
    const title = document.createElement('div');
    title.className = 'np-tooltip-title';
    title.textContent = this.heading(index);
    const list = document.createElement('div');
    list.className = 'np-tooltip-rows';
    for (const [value, label, className] of this.rows(index)) {
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
  }
}

/** The part of a timeline within a window, for showing at once while the host zooms. */
export function viewOf(data: TimelineData, window: TimeWindow): TimelineData {
  return {
    ...data,
    from: window.from,
    to: window.to,
    buckets: data.buckets.filter(
      (bucket) => bucket.start + data.bucketMs > window.from && bucket.start < window.to,
    ),
  };
}

/** The last observation at or before `time`. */
export function quotaAt(points: readonly QuotaPoint[], time: number): QuotaPoint | undefined {
  let found: QuotaPoint | undefined;
  for (const point of points) {
    if (point.time > time) break;
    found = point;
  }
  return found;
}

/**
 * A quota series as observed: straight between readings, dropping to zero where its window
 * reset between two of them, and broken where Nightpace wasn't running.
 */
function quotaPath(
  points: readonly QuotaPoint[],
  key: 'fiveHour' | 'weekly',
  resetKey: 'fiveHourReset' | 'weeklyReset',
  x: (time: number) => number,
  y: (value: number) => number,
): string {
  let d = '';
  let previous: QuotaPoint | undefined;
  for (const point of points) {
    const value = point[key];
    if (value === undefined) {
      previous = undefined;
      continue;
    }
    const reset = previous?.[resetKey];
    if (!previous) {
      d += `M${x(point.time)},${y(value)}`;
    } else if (reset !== undefined && reset <= point.time) {
      d += `L${x(reset)},${y(previous[key]!)}V${y(0)}`;
      d +=
        point.time - reset > QUOTA_GAP_MS
          ? `M${x(point.time)},${y(value)}`
          : `L${x(point.time)},${y(value)}`;
    } else if (point.time - previous.time > QUOTA_GAP_MS) {
      d += `M${x(point.time)},${y(value)}`;
    } else {
      d += `L${x(point.time)},${y(value)}`;
    }
    previous = point;
  }
  return d;
}
