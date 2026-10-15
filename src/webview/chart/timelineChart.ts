// The timeline: three lanes on one time axis. Plan quota (5-hour and weekly, as observed), the
// sessions working at once, and weighted tokens by model. Each lane has its own value axis;
// no lane ever carries two (no dual axes). Colors come from CSS, so a theme change restyles it.
import type {
  ModelFamily,
  PanelStrings,
  QuotaPoint,
  TimelineData,
  TokenBucket,
} from '../../shared/protocol';
import type { Formats } from '../format';
import { columnPath, svg } from './svg';
import { timeTicks, valueTicks } from './ticks';

const LEFT = 48;
const RIGHT = 56;
const TITLE = 26;
const LANE_GAP = 18;
const AXIS = 24;
const HEIGHTS = { quota: 140, sessions: 64, tokens: 120 };
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

  constructor(
    private readonly strings: PanelStrings,
    private readonly formats: Formats,
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

  render(data: TimelineData, width: number): void {
    this.data = data;
    this.width = Math.max(width, 320);
    this.svgRoot = this.draw(data, this.width);
    if (this.index !== undefined) this.hover(Math.min(this.index, data.buckets.length - 1));
  }

  private draw(data: TimelineData, width: number): SVGSVGElement {
    const plotRight = width - RIGHT;
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
    hit.addEventListener('pointermove', (event) => {
      const box = root.getBoundingClientRect();
      const time = data.from + ((event.clientX - box.left - LEFT) / (plotRight - LEFT)) * span;
      this.hover(this.bucketAt(time));
    });
    hit.addEventListener('pointerleave', () => {
      if (document.activeElement !== this.element) this.hover(undefined);
    });
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
      const last = [...data.quota].reverse().find((point) => point[series.key] !== undefined);
      if (last && last.time >= data.from) {
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
    this.laneTitle(
      root,
      lane,
      s.tokensLane,
      data.models.map((model) => ({
        className: modelClass(model),
        label: s.models[model],
        shape: 'rect' as const,
      })),
    );
    const totals = data.buckets.map(total);
    const ticks = valueTicks(Math.max(...totals, 0), 2);
    const y = this.valueAxis(root, lane, ticks, (v) => this.formats.amount(v), plotRight);
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
    const columns = svg('g', { class: 'np-columns' });
    data.buckets.forEach((bucket, index) => {
      const left = x(bucket.start) + (slot - width) / 2;
      if (left + width > plotRight + 1) return;
      const group = svg('g', { class: 'np-col', 'data-index': index });
      let base = y(0);
      const drawn = data.models.filter((model) => (bucket.byModel[model] ?? 0) * scale >= 0.5);
      drawn.forEach((model, i) => {
        if (i > 0) base -= 2; // the surface gap between stacked segments
        const height = Math.max(1, (bucket.byModel[model] ?? 0) * scale - (i > 0 ? 2 : 0));
        group.append(
          svg('path', {
            d: columnPath(left, base - height, width, height, i === drawn.length - 1),
            class: `np-bar ${modelClass(model)}`,
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
    const index = Math.floor((time - data.from) / data.bucketMs);
    return Math.min(Math.max(index, 0), data.buckets.length - 1);
  }

  private key(event: KeyboardEvent): void {
    const data = this.data;
    if (!data || data.buckets.length === 0) return;
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
    for (const model of data.models) {
      const value = bucket.byModel[model];
      if (value) rows.push([this.formats.amount(value), s.models[model], modelClass(model)]);
    }
    rows.push([String(bucket.requests), s.requests, '']);
    return rows;
  }

  private heading(index: number): string {
    const data = this.data!;
    const bucket = data.buckets[index];
    const end = Math.min(bucket.start + data.bucketMs, data.to);
    const day = data.bucketMs >= 12 * 3_600_000 || data.range !== '24h';
    const start = day ? this.formats.dayClock(bucket.start) : this.formats.clock(bucket.start);
    return `${start}–${this.formats.clock(end)}`;
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

export function modelClass(model: ModelFamily): string {
  return `np-m-${model}`;
}

function total(bucket: TokenBucket): number {
  return Object.values(bucket.byModel).reduce((sum, value) => sum + (value ?? 0), 0);
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
