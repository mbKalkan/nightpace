// The timeline: four lanes on one time axis. Plan quota (5-hour and weekly, as observed), the
// weekly limit a day at a time, the sessions working at once, and API cost or tokens by model,
// effort level or token type. Each lane has its own value axis; no lane ever carries two (no dual
// axes). Colors come from CSS, so a theme change restyles it.
// Estimated quota is dashed: before the first reading, and the week ahead at the present pace,
// which takes the time axis past now.
// Dragging across it with the right button, scrolling (or a pinch), double-clicking and the plus,
// minus and zero keys ask to zoom; dragging it with the left button or Shift and the arrow keys
// pan. The panel decides what that means for the range. The crosshair takes a column, or over the
// quota and sessions lanes the nearest point of their lines, which can fall between two columns'
// ends; over the days, a day. Past now it follows the week ahead, to where it runs out and resets.
import type {
  LimitHit,
  PanelStrings,
  QuotaPoint,
  TimelineData,
  TimeWindow,
  TokenMeasure,
  TokenSplit,
  WeekDay,
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
// The quota keeps its height; the other lanes give some of theirs to the days.
const HEIGHTS = { quota: 140, days: 64, sessions: 48, tokens: 100 };
/** The whole chart, four lanes under their titles and the time axis. */
export const CHART_HEIGHT =
  4 * TITLE +
  HEIGHTS.quota +
  HEIGHTS.days +
  HEIGHTS.sessions +
  HEIGHTS.tokens +
  3 * LANE_GAP +
  AXIS;
/** A drag shorter than this is a click, not a zoom. */
const MIN_DRAG_PX = 6;
/** Over the quota and sessions lanes, the crosshair takes a point of their lines this close. */
const SNAP_PX = 16;
/** Readings this close to the pointer on either side are told apart by its height. */
const PICK_PX = 2;
/** Polling is hourly when idle: a longer silence means Nightpace wasn't running. */
const QUOTA_GAP_MS = 75 * 60_000;
const DAY = 86_400_000;
/** A seventh of the weekly limit a day spends it evenly over the week. */
const EVEN = 100 / 7;
/** A day's column says its value on its cap where there is this much room for it. */
const DAY_LABEL_PX = 36;
const QUOTA_SERIES = [
  { key: 'fiveHour', reset: 'fiveHourReset', span: 5 * 3_600_000, className: 'np-s-five' },
  { key: 'weekly', reset: 'weeklyReset', span: 7 * 86_400_000, className: 'np-s-week' },
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
  /** The points of the lanes' lines, and the one under the crosshair when it is not on a column. */
  private moments: Record<LineLane, Moment[]> = { quota: [], sessions: [] };
  private pointed: { lane: LineLane; moment: Moment } | undefined;
  /** The day under the crosshair, in `data.days`. */
  private dayIndex: number | undefined;
  private x: (time: number) => number = () => 0;
  private percentY: (value: number) => number = () => 0;
  private sessionsY: (count: number) => number = () => 0;
  private plotRight = 0;
  /** Where the axis ends, past now when the week ahead is drawn. */
  private axisRight = 0;
  /** Where the quota, days and sessions lanes end, halfway to the next lane. */
  private quotaBottom = 0;
  private daysBottom = 0;
  private sessionsBottom = 0;
  /** What the token lane's columns are split by; the panel sets it before rendering. */
  split: TokenSplit = 'model';
  /** What the token lane measures; the panel sets it before rendering. */
  measure: TokenMeasure = 'cost';
  /** Where a drag to zoom started, as a client x coordinate. */
  private dragFrom: number | undefined;
  /** Whether the left button is held down to pan. */
  private panning = false;
  /**
   * Takes the pointer and the wheel over the plot. It outlives the redraws: Chromium sends the rest
   * of a scroll to the element that took its first wheel event, and a replaced one would leave the
   * scroll to the panel.
   */
  private readonly hit = svg('rect', { class: 'np-hit' });
  /** The same past today's column, over the week ahead. */
  private readonly hitAhead = svg('rect', { class: 'np-hit-ahead' });
  private plotTop = 0;
  private plotBottom = 0;
  /** A stretch of time to mark, such as the session under the pointer in the table. */
  private marked: TimeWindow | undefined;

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
    this.listen(this.hit);
    this.listen(this.hitAhead);
  }

  private listen(hit: SVGRectElement): void {
    // The right button selects a window, so the plot has no context menu.
    hit.addEventListener('contextmenu', (event) => event.preventDefault());
    hit.addEventListener('pointerdown', (event) => {
      if (event.button === 0) this.startPan(event);
      if (event.button !== 2) return;
      hit.setPointerCapture(event.pointerId);
      this.dragFrom = event.clientX;
    });
    hit.addEventListener('pointermove', (event) => {
      if (this.panning) return;
      if (this.dragFrom !== undefined && Math.abs(event.clientX - this.dragFrom) >= MIN_DRAG_PX) {
        this.hover(undefined);
        this.drawBrush(this.dragFrom, event.clientX);
        return;
      }
      const time = this.timeAt(event.clientX);
      // Over a lane of lines, a point between two columns' ends can be pointed at too.
      const y = event.clientY - this.svgRoot!.getBoundingClientRect().top;
      const overDays = y > this.quotaBottom && y <= this.daysBottom;
      const lane: LineLane | undefined =
        y <= this.quotaBottom
          ? 'quota'
          : !overDays && y <= this.sessionsBottom
            ? 'sessions'
            : undefined;
      // Over the days, the day under the pointer, ahead of now too.
      const day = overDays ? this.dayAt(this.timeAt(event.clientX, true)) : undefined;
      if (day !== undefined) {
        this.hoverDay(day);
        return;
      }
      const ahead = this.aheadAt(event.clientX, lane !== undefined);
      if (ahead) {
        this.hoverMoment('quota', ahead);
        return;
      }
      const moment = lane && this.nearest(lane, time, y);
      if (lane && moment && Math.abs(this.x(moment.time) - this.x(time)) <= SNAP_PX) {
        this.hoverMoment(lane, moment);
      } else {
        this.hover(this.bucketAt(time));
      }
    });
    hit.addEventListener('pointerup', (event) => this.endDrag(event.clientX));
    hit.addEventListener('pointercancel', () => this.endDrag(undefined));
    hit.addEventListener('pointerleave', () => {
      if (document.activeElement !== this.element) this.hover(undefined);
    });
    hit.addEventListener('wheel', (event) => this.wheel(event), { passive: false });
    hit.addEventListener('dblclick', () => {
      if (this.data && !coversExtent(this.window, this.data.extent)) this.onZoom(undefined);
    });
  }

  /** Marks a stretch of time across the lanes, or clears the mark. */
  mark(span: TimeWindow | undefined): void {
    this.marked = span;
    if (this.svgRoot) this.drawMark(this.svgRoot);
  }

  private drawMark(root: SVGSVGElement): void {
    root.querySelector('.np-mark')?.remove();
    const span = this.marked;
    const data = this.data;
    if (!span || !data || span.to < data.from || span.from > data.to) return;
    const left = Math.max(this.x(span.from), LEFT);
    // A single request still shows as a sliver.
    const right = Math.max(Math.min(this.x(span.to), this.plotRight), left + 2);
    // Behind everything else.
    root.querySelector('defs')!.after(
      svg('rect', {
        class: 'np-mark',
        x: left,
        y: this.plotTop,
        width: right - left,
        height: this.plotBottom - this.plotTop,
      }),
    );
  }

  /**
   * Moving with the left button held down drags the window along time, like a map. The moves are
   * followed on the page, not on the plot: each step redraws it, which would drop a capture.
   */
  private startPan(event: PointerEvent): void {
    const data = this.data;
    if (!data || coversExtent(this.window, data.extent)) return;
    event.preventDefault();
    const start = this.window;
    const from = event.clientX;
    const perPixel = (start.to - start.from) / (this.plotRight - LEFT);
    this.panning = true;
    this.hover(undefined);
    this.element.classList.add('np-panning');
    const end = () => {
      this.panning = false;
      this.element.classList.remove('np-panning');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    const move = (moved: PointerEvent) => {
      // Let go of outside the panel, where the release is never seen.
      if ((moved.buttons & 1) === 0) return end();
      this.onZoom(shiftWindow(start, (from - moved.clientX) * perPixel));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  /** Draws the timeline, or the part of it within `window` while the host zooms. */
  render(data: TimelineData, width: number, window?: TimeWindow): void {
    // The crosshair stays at the same time, not at the same column or point.
    const previous = this.data;
    const hovered =
      previous && this.index !== undefined
        ? previous.buckets[this.index].start + previous.bucketMs / 2
        : undefined;
    const pointed = this.pointed;
    const day = this.dayIndex !== undefined ? previous?.days?.[this.dayIndex]?.from : undefined;
    this.data = window ? viewOf(data, window) : data;
    this.width = Math.max(width, 320);
    this.svgRoot = this.draw(this.data, this.width);
    this.element.classList.toggle('np-zoomed', !coversExtent(this.window, this.data.extent));
    const moment = pointed && this.nearest(pointed.lane, pointed.moment.time);
    const sameDay = this.data.days?.findIndex((each) => each.from === day) ?? -1;
    if (pointed && moment) this.hoverMoment(pointed.lane, moment);
    else if (sameDay >= 0) this.hoverDay(sameDay);
    else if (hovered !== undefined) this.hover(this.bucketAt(hovered));
    else this.dayIndex = undefined;
  }

  private draw(data: TimelineData, width: number): SVGSVGElement {
    const plotRight = width - RIGHT;
    // The week ahead takes the axis past now; pointing, zooming and panning stay before it.
    const forecast = weeklyForecast(data);
    const end = forecast?.end ?? data.to;
    const x = (time: number) =>
      LEFT + ((time - data.from) / (end - data.from)) * (plotRight - LEFT);
    this.x = x;
    this.plotRight = x(data.to);
    this.axisRight = plotRight;

    const quota: Lane = { top: TITLE, height: HEIGHTS.quota };
    const days: Lane = { top: quota.top + quota.height + LANE_GAP + TITLE, height: HEIGHTS.days };
    const sessions: Lane = {
      top: days.top + days.height + LANE_GAP + TITLE,
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

    this.plotTop = quota.top;
    this.plotBottom = tokens.top + tokens.height;
    this.quotaBottom = quota.top + quota.height + LANE_GAP / 2;
    this.daysBottom = days.top + days.height + LANE_GAP / 2;
    this.sessionsBottom = sessions.top + sessions.height + LANE_GAP / 2;
    this.moments = chartMoments(data, forecast);
    this.drawTimeGrid(root, data, x, quota.top, tokens.top + tokens.height, end, plotRight);
    this.drawQuota(root, data, quota, x, plotRight, forecast);
    this.drawDays(root, data, days, x, plotRight);
    this.drawSessions(root, data, sessions, x, plotRight);
    this.drawTokens(root, data, tokens, x, plotRight);
    this.drawMark(root);

    const hit = this.hit;
    hit.setAttribute('x', String(LEFT));
    hit.setAttribute('y', String(quota.top));
    // Over today's column too, which runs on past now.
    const lastEnd = (data.buckets.at(-1)?.start ?? data.from) + data.bucketMs;
    const hitRight = Math.min(x(lastEnd), plotRight);
    hit.setAttribute('width', String(hitRight - LEFT));
    hit.setAttribute('height', String(tokens.top + tokens.height - quota.top));
    const ahead = this.hitAhead;
    ahead.setAttribute('x', String(hitRight));
    ahead.setAttribute('y', String(quota.top));
    ahead.setAttribute('width', String(Math.max(0, plotRight - hitRight)));
    ahead.setAttribute('height', String(tokens.top + tokens.height - quota.top));
    root.append(
      svg('line', {
        class: 'np-crosshair',
        visibility: 'hidden',
        y1: quota.top,
        y2: tokens.top + tokens.height,
      }),
      hit,
      ...(forecast ? [ahead] : []),
    );
    return root;
  }

  private drawTimeGrid(
    root: SVGSVGElement,
    data: TimelineData,
    x: (time: number) => number,
    top: number,
    bottom: number,
    end: number,
    plotRight: number,
  ): void {
    // As many labels across the time before now as without the week ahead, and more after it.
    const stretch = (end - data.from) / (data.to - data.from);
    const { times, step } = timeTicks(
      data.from,
      end,
      Math.max(3, Math.floor((this.width / 110) * stretch)),
    );
    const group = svg('g', { class: 'np-axis' });
    if (end > data.to) {
      group.append(
        svg('rect', {
          class: 'np-future',
          x: x(data.to),
          y: top,
          width: plotRight - x(data.to),
          height: bottom - top,
        }),
      );
    }
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
    // Where one quota week ends and the next begins: the columns are counted from here.
    const ahead = data.pace?.week.resetsAt;
    const resets =
      ahead !== undefined && ahead > data.to ? [...data.weeklyResets, ahead] : data.weeklyResets;
    for (const time of resets) {
      if (time <= data.from || time > end || time === data.to) continue;
      group.append(
        svg('line', { class: 'np-reset', x1: x(time), x2: x(time), y1: top, y2: bottom }),
      );
    }
    root.append(group);
  }

  /** A lane's title, with a legend of keys after it, and a note at the right end. */
  private laneTitle(
    root: SVGSVGElement,
    lane: Lane,
    title: string,
    keys: Array<{ className: string; label: string; shape: 'line' | 'rect' | 'mark' }>,
    note?: string,
    /** Whether a note with no room beside the legend is left out rather than moved into the plot. */
    dropNote = false,
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
          : key.shape === 'mark'
            ? svg('path', {
                class: key.className,
                d: `M${cursor},${y - 8}L${cursor + 9},${y - 8}L${cursor + 4.5},${y - 1}Z`,
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
      // Where the legend leaves no room, the note moves into the top of the plot, or goes.
      if (this.width - RIGHT - text.getComputedTextLength() < cursor && dropNote) {
        text.remove();
      } else if (this.width - RIGHT - text.getComputedTextLength() < cursor) {
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
    forecast: WeeklyForecast | undefined,
  ): void {
    const s = this.strings;
    const recording = data.recordingSince;
    const note =
      recording === undefined
        ? undefined
        : recording > data.from
          ? s.quotaSince.replace('{0}', this.formats.dayClock(recording))
          : undefined;
    const estimate = data.quotaEstimate ?? [];
    const hits = data.limitHits.filter((hit) => hit.time >= data.from && hit.time <= data.to);
    // The same scale as the lane's value axis, drawn after the legend.
    const percentY = (value: number) => lane.top + lane.height - (value / 100) * lane.height;
    this.percentY = percentY;
    const paths = QUOTA_SERIES.map((series) => ({
      series,
      ...quotaPath(data.quota, series.key, series.reset, series.span, x, percentY),
    }));
    this.laneTitle(
      root,
      lane,
      s.quotaLane,
      [
        { className: 'np-s-five', label: s.fiveHour, shape: 'line' },
        { className: 'np-s-week', label: s.weekly, shape: 'line' },
        ...(data.weeklyResets.length > 0
          ? [{ className: 'np-reset', label: s.weeklyReset, shape: 'line' as const }]
          : []),
        ...(paths.some((path) => path.unrecorded)
          ? [{ className: 'np-unrecorded', label: s.notRecorded, shape: 'line' as const }]
          : []),
        ...(estimate.length > 0 || forecast
          ? [{ className: 'np-estimated', label: s.estimated, shape: 'line' as const }]
          : []),
        ...(hits.length > 0
          ? [{ className: 'np-limit-key', label: s.limitReached, shape: 'mark' as const }]
          : []),
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
    for (const series of QUOTA_SERIES) {
      const d = estimate
        .filter((point) => point[series.key] !== undefined)
        .map((point, i) => `${i ? 'L' : 'M'}${x(point.time)},${y(point[series.key]!)}`)
        .join('');
      if (!d) continue;
      root.append(
        svg('path', {
          d,
          class: `np-line np-estimated ${series.className}`,
          'clip-path': 'url(#np-plot-clip)',
        }),
      );
    }
    const ends: Array<{ x: number; y: number; text: string; className: string }> = [];
    // The labels of the readings sit by their dots once the axis runs on past now.
    const labelX = forecast ? this.plotRight + 8 : plotRight + 10;
    for (const { series, observed, unrecorded } of paths) {
      if (!observed) continue;
      root.append(
        svg('path', {
          d: observed,
          class: `np-line ${series.className}`,
          'clip-path': 'url(#np-plot-clip)',
        }),
      );
      if (unrecorded) {
        root.append(
          svg('path', {
            d: unrecorded,
            class: `np-line np-unrecorded ${series.className}`,
            'clip-path': 'url(#np-plot-clip)',
          }),
        );
      }
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
        // The weekly line's label goes to the end of where it is heading.
        if (!(forecast && series.key === 'weekly')) {
          ends.push({
            x: labelX,
            y: y(value),
            text: this.formats.percent(value),
            className: series.className,
          });
        }
      }
    }
    // Where a limit ran out: a mark hanging from 100%, in its series' color.
    for (const hit of hits) {
      const cx = x(hit.time);
      const top = y(100);
      root.append(
        svg('path', {
          d: `M${cx - 4.5},${top}L${cx + 4.5},${top}L${cx},${top + 7}Z`,
          class: `np-limit ${hit.limit === 'fiveHour' ? 'np-s-five' : 'np-s-week'}`,
        }),
      );
    }
    if (forecast) {
      const d = forecast.points
        .map(([time, value], i) => `${i ? 'L' : 'M'}${x(time)},${y(value)}`)
        .join('');
      root.append(
        svg('path', {
          d,
          class: 'np-line np-estimated np-s-week',
          'clip-path': 'url(#np-plot-clip)',
        }),
      );
      const [time, value] = forecast.points[forecast.points.length - 1];
      ends.push({
        x: x(time) + 8,
        y: y(value),
        text: this.formats.percent(value),
        className: 'np-s-week',
      });
    }
    // End labels that would collide are left to the legend and the tooltip.
    const apart =
      ends.length < 2 || ends[0].x !== ends[1].x || Math.abs(ends[0].y - ends[1].y) >= 14;
    for (const end of apart ? ends : ends.slice(0, 1)) {
      root.append(svg('text', { x: end.x, y: end.y + 4, class: 'np-end-label' }, end.text));
    }
  }

  /**
   * The weekly limit a day at a time, a column a day from the reset: read, or lighter where it is
   * estimated, and dashed what each day ahead can take for the week to last. A seventh of the
   * limit a day is marked across.
   */
  private drawDays(
    root: SVGSVGElement,
    data: TimelineData,
    lane: Lane,
    x: (time: number) => number,
    plotRight: number,
  ): void {
    const s = this.strings;
    const f = this.formats;
    const days = data.days ?? [];
    const note = days.length > 0 ? s.daysNote.replaceAll('{0}', f.clock(days[0].from)) : undefined;
    this.laneTitle(
      root,
      lane,
      s.daysLane,
      [
        ...(days.some((day) => !day.estimated && day.used !== undefined)
          ? [{ className: 'np-day-bar np-s-week', label: s.used, shape: 'rect' as const }]
          : []),
        ...(days.some((day) => day.estimated && day.used !== undefined)
          ? [
              {
                className: 'np-day-bar np-s-week np-day-estimated',
                label: s.estimated,
                shape: 'rect' as const,
              },
            ]
          : []),
        ...(days.some((day) => (day.canTake ?? 0) > 0)
          ? [{ className: 'np-day-budget', label: s.budgetToLast, shape: 'rect' as const }]
          : []),
        ...(days.length > 0
          ? [{ className: 'np-even', label: s.evenSplit, shape: 'line' as const }]
          : []),
      ],
      note,
      // Columns fill the top of this lane: a day says where it starts in its tooltip anyway.
      true,
    );
    const tops = days.map((day) => (day.used ?? 0) + (day.canTake ?? 0));
    const ticks = valueTicks(Math.max(EVEN, ...tops) * 1.1, 3);
    const y = this.valueAxis(root, lane, ticks, (v) => `${v}%`, plotRight);
    if (days.length === 0) {
      root.append(
        svg(
          'text',
          {
            x: (LEFT + plotRight) / 2,
            y: lane.top + lane.height / 2,
            'text-anchor': 'middle',
            class: 'np-note',
          },
          data.pace ? s.empty : s.noQuotaYet,
        ),
      );
      return;
    }
    root.append(
      svg('line', {
        class: 'np-even',
        x1: LEFT,
        x2: plotRight,
        y1: y(EVEN),
        y2: y(EVEN),
      }),
      svg('text', { class: 'np-end-label', x: plotRight + 8, y: y(EVEN) + 4 }, f.fine(EVEN)),
    );
    const group = svg('g', { class: 'np-days', 'clip-path': 'url(#np-plot-clip)' });
    days.forEach((day, index) => {
      const slot = x(day.to) - x(day.from);
      const width = Math.max(2, Math.min(24, slot - 4));
      const center = x(day.from + DAY / 2);
      const left = center - width / 2;
      const column = svg('g', { class: 'np-day', 'data-index': index });
      const used = day.used ?? 0;
      const usedHeight = y(0) - y(used);
      const aheadHeight = y(0) - y(day.canTake ?? 0);
      if (usedHeight >= 0.5) {
        column.append(
          svg('path', {
            d: columnPath(left, y(used), width, Math.max(1, usedHeight), aheadHeight < 1),
            class: `np-day-bar np-s-week${day.estimated ? ' np-day-estimated' : ''}`,
          }),
        );
      }
      // What the rest of the day can take sits on what it used, a gap apart.
      const base = usedHeight >= 0.5 ? y(used) - 2 : y(0);
      if (aheadHeight >= 1) {
        column.append(
          svg('path', {
            d: columnPath(left, base - aheadHeight, width, aheadHeight, true),
            class: 'np-day-budget',
          }),
        );
      }
      // The value on the cap where there is room: what the day used, or for a day ahead what it
      // can take. Today's use sits on its own part, within what it can still take if that fits.
      const value = day.used ?? day.canTake;
      if (value !== undefined && slot >= DAY_LABEL_PX) {
        const inside = day.used !== undefined && aheadHeight >= 20;
        const top = aheadHeight >= 1 && !inside ? base - aheadHeight : y(used);
        const kind = day.used === undefined ? ' np-day-ahead' : inside ? ' np-day-inside' : '';
        column.append(
          svg(
            'text',
            { class: `np-day-label${kind}`, x: center, y: top - 5, 'text-anchor': 'middle' },
            f.fine(value),
          ),
        );
      }
      group.append(column);
    });
    root.append(group);
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
    this.sessionsY = y;
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

  /** The time under a client x coordinate, within the window shown or, `ahead`, past now. */
  private timeAt(clientX: number, ahead = false): number {
    const data = this.data!;
    const box = this.svgRoot!.getBoundingClientRect();
    const share = Math.max((clientX - box.left - LEFT) / (this.plotRight - LEFT), 0);
    return data.from + (ahead ? share : Math.min(share, 1)) * (data.to - data.from);
  }

  /**
   * Past now, the point of the week ahead nearest the pointer: anywhere over the lanes of lines,
   * and over the columns once past today's.
   */
  private aheadAt(clientX: number, overLines: boolean): Moment | undefined {
    const data = this.data!;
    const time = this.timeAt(clientX, true);
    const lastEnd = (data.buckets.at(-1)?.start ?? data.from) + data.bucketMs;
    if (time <= data.to || (!overLines && time < lastEnd)) return undefined;
    const nearest = this.nearest('quota', time);
    if (nearest?.ahead) return nearest;
    return this.moments.quota.find((moment) => moment.ahead);
  }

  private get window(): TimeWindow {
    return { from: this.data!.from, to: this.data!.to };
  }

  private drawBrush(from: number, to: number): void {
    const root = this.svgRoot!;
    const box = root.getBoundingClientRect();
    const left = Math.max(Math.min(from, to) - box.left, LEFT);
    const right = Math.min(Math.max(from, to) - box.left, this.plotRight);
    let brush = root.querySelector('.np-brush');
    if (!brush) {
      brush = svg('rect', {
        class: 'np-brush',
        y: this.plotTop,
        height: this.plotBottom - this.plotTop,
      });
      root.querySelector('.np-crosshair')!.before(brush);
    }
    brush.setAttribute('x', String(left));
    brush.setAttribute('width', String(Math.max(right - left, 0)));
  }

  /** Escape lets go of a window being selected without zooming into it. */
  private cancelDrag(): boolean {
    if (this.dragFrom === undefined) return false;
    this.dragFrom = undefined;
    this.svgRoot?.querySelector('.np-brush')?.remove();
    return true;
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

  /**
   * Scrolling (a pinch on a touchpad) zooms around the pointer; sideways or Shift + scroll pans.
   * Over the plot the wheel never scrolls the panel. A panel scroll that started elsewhere and
   * runs on under the pointer is left alone: it can no longer be cancelled.
   */
  private wheel(event: WheelEvent): void {
    const data = this.data;
    if (!data || !event.cancelable) return;
    event.preventDefault();
    const whole = coversExtent(this.window, data.extent);
    const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    if (sideways || (event.shiftKey && !event.ctrlKey)) {
      if (whole) return;
      const pixels = sideways ? event.deltaX : event.deltaY;
      const perPixel = (data.to - data.from) / (this.plotRight - LEFT);
      this.onZoom(shiftWindow(this.window, pixels * perPixel));
      return;
    }
    // Out from the whole range there is nowhere to go: no request to the host.
    if (whole && event.deltaY > 0) return;
    const exponent = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 0.05 : 0.002);
    const factor = Math.exp(Math.min(Math.max(exponent, -0.7), 0.7));
    this.onZoom(scaleWindow(this.window, factor, this.timeAt(event.clientX)));
  }

  /** Plus and minus zoom around the crosshair, or the middle; zero shows the whole range. */
  private zoomKey(key: string): boolean {
    const data = this.data!;
    const day = this.dayIndex !== undefined ? data.days?.[this.dayIndex] : undefined;
    const center = Math.min(
      this.pointed?.moment.time ??
        (day && day.from + DAY / 2) ??
        (this.index !== undefined
          ? data.buckets[this.index].start + data.bucketMs / 2
          : (data.from + data.to) / 2),
      // From the week ahead, around now: there is nothing to zoom into past it.
      data.to,
    );
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
    if (event.key === 'Escape' && this.cancelDrag()) return;
    // Shift and an arrow move the zoomed window by a quarter of its length.
    if (event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      if (coversExtent(this.window, data.extent)) return;
      const quarter = (data.to - data.from) / 4;
      this.onZoom(shiftWindow(this.window, event.key === 'ArrowLeft' ? -quarter : quarter));
      return;
    }
    if (event.key === 'Escape') {
      this.hover(undefined);
      return;
    }
    // From a day, the keys go on a day at a time.
    if (this.dayIndex !== undefined && data.days) {
      const step = stepTo(event.key, this.dayIndex, data.days.length - 1);
      if (step === undefined) return;
      event.preventDefault();
      this.hoverDay(step);
      this.live.textContent = this.describeDay(data.days[step]).join(', ');
      return;
    }
    // From a point of a lane's lines, the keys go on along them.
    if (this.pointed) {
      const { lane, moment } = this.pointed;
      const moments = this.moments[lane];
      const step = stepTo(event.key, moments.indexOf(moment), moments.length - 1);
      if (step === undefined) return;
      event.preventDefault();
      this.hoverMoment(lane, moments[step]);
      this.live.textContent = this.describeMoment(moments[step]).join(', ');
      return;
    }
    // From today's column, on to the week ahead.
    const ahead = this.moments.quota.find((moment) => moment.ahead);
    if (event.key === 'ArrowRight' && this.index === data.buckets.length - 1 && ahead) {
      event.preventDefault();
      this.hoverMoment('quota', ahead);
      this.live.textContent = this.describeMoment(ahead).join(', ');
      return;
    }
    const next = stepTo(event.key, this.index, data.buckets.length - 1);
    if (next === undefined) return;
    event.preventDefault();
    this.hover(next);
    this.live.textContent = this.describe(next).join(', ');
  }

  /** Points at a column, or at nothing. */
  private hover(index: number | undefined): void {
    this.index = index;
    this.pointed = undefined;
    this.dayIndex = undefined;
    const data = this.data;
    if (!data) return;
    const center =
      index === undefined
        ? undefined
        : this.x(Math.min(data.buckets[index].start + data.bucketMs / 2, data.to));
    this.place(center, () => this.fillTooltip(this.heading(index!), this.rows(index!)));
  }

  /** Points at a point of a lane's lines, with a dot on each of them. */
  private hoverMoment(lane: LineLane, moment: Moment): void {
    this.index = undefined;
    this.dayIndex = undefined;
    this.pointed = { lane, moment };
    const center = this.x(moment.time);
    this.place(center, () => this.fillTooltip(this.momentHeading(moment), this.momentRows(moment)));
    const crosshair = this.svgRoot!.querySelector('.np-crosshair')!;
    for (const [y, className] of this.dots(lane, moment)) {
      crosshair.after(
        svg('circle', { cx: center, cy: y, r: 4, class: `np-dot np-hover-dot ${className}` }),
      );
    }
  }

  /** Where a point sits on each of its lane's lines, as [y, series class]. */
  private dots(lane: LineLane, moment: Moment): Array<[number, string]> {
    if (lane === 'sessions') return [[this.sessionsY(moment.sessions), 'np-s-sessions']];
    return QUOTA_SERIES.flatMap((series) => {
      const value = moment[series.key];
      return value === undefined
        ? []
        : [[this.percentY(value), series.className] as [number, string]];
    });
  }

  /** Moves the crosshair and the tooltip to `center`, or hides them. */
  private place(center: number | undefined, fill: () => void): void {
    const root = this.svgRoot;
    if (!root) return;
    root.classList.toggle('np-hovering', this.index !== undefined);
    for (const column of root.querySelectorAll('.np-col')) {
      column.classList.toggle(
        'np-active',
        Number(column.getAttribute('data-index')) === this.index,
      );
    }
    root.classList.toggle('np-days-hovering', this.dayIndex !== undefined);
    for (const day of root.querySelectorAll('.np-day')) {
      day.classList.toggle('np-active', Number(day.getAttribute('data-index')) === this.dayIndex);
    }
    for (const dot of root.querySelectorAll('.np-hover-dot')) dot.remove();
    const crosshair = root.querySelector('.np-crosshair');
    if (center === undefined) {
      this.tooltip.hidden = true;
      crosshair?.setAttribute('visibility', 'hidden');
      return;
    }
    crosshair?.setAttribute('x1', String(center));
    crosshair?.setAttribute('x2', String(center));
    crosshair?.setAttribute('visibility', 'visible');
    fill();
    this.tooltip.hidden = false;
    const width = this.tooltip.offsetWidth;
    const left = center + 14 + width > this.width ? center - 14 - width : center + 14;
    this.tooltip.style.left = `${Math.max(0, left)}px`;
    this.tooltip.style.top = `${TITLE}px`;
  }

  /** Points at a day, with the crosshair through its middle. */
  private hoverDay(index: number): void {
    const day = this.data!.days![index];
    this.index = undefined;
    this.pointed = undefined;
    this.dayIndex = index;
    const center = Math.min(Math.max(this.x(day.from + DAY / 2), LEFT), this.axisRight);
    this.place(center, () =>
      this.fillTooltip(this.formats.window(day.from, day.to), this.dayRows(day)),
    );
  }

  /** The day at `time` among those drawn. */
  private dayAt(time: number): number | undefined {
    const index = this.data?.days?.findIndex((day) => day.from <= time && time < day.to) ?? -1;
    return index >= 0 ? index : undefined;
  }

  /** What a day used, can take and cost, as rows of [value, label, series class]. */
  private dayRows(day: WeekDay): Array<[string, string, string]> {
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

  private describeDay(day: WeekDay): string[] {
    return [
      this.formats.window(day.from, day.to),
      ...this.dayRows(day).map(([value, label]) => `${label} ${value}`),
    ];
  }

  /**
   * The point of a lane's lines closest in time, within the window shown. Zoomed out, several
   * share a pixel: given the pointer's height, the one nearest to it of those within `PICK_PX`, so
   * the top of a peak and the drop after it can both be taken.
   */
  private nearest(lane: LineLane, time: number, y?: number): Moment | undefined {
    const moments = this.moments[lane];
    if (moments.length === 0) return undefined;
    let low = 0;
    let high = moments.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (moments[middle].time < time) low = middle + 1;
      else high = middle;
    }
    const before = moments[Math.max(low - 1, 0)];
    const closest = time - before.time <= moments[low].time - time ? before : moments[low];
    if (y === undefined) return closest;
    const reach = PICK_PX / (this.x(1) - this.x(0));
    let best = closest;
    let distance = Infinity;
    const consider = (moment: Moment) => {
      for (const [height] of this.dots(lane, moment)) {
        const away = Math.abs(height - y);
        // Along a flat line, the point closest in time.
        const sooner = Math.abs(moment.time - time) < Math.abs(best.time - time);
        if (away < distance || (away === distance && sooner)) [best, distance] = [moment, away];
      }
    };
    for (let i = low - 1; i >= 0 && time - moments[i].time <= reach; i--) consider(moments[i]);
    for (let i = low; i < moments.length && moments[i].time - time <= reach; i++) {
      consider(moments[i]);
    }
    return best;
  }

  /** The values at a bucket, as rows of [value, label, series class]. */
  private rows(index: number): Array<[string, string, string]> {
    const data = this.data!;
    const s = this.strings;
    const bucket = data.buckets[index];
    const end = Math.min(bucket.start + data.bucketMs, data.to);
    const recorded = quotaAt(data.quota, end);
    // Before the first reading, the estimate says what it can.
    const estimated = recorded ? undefined : quotaAt(data.quotaEstimate ?? [], end);
    const quota = recorded ?? estimated;
    const name = (label: string) => (estimated ? s.estimatedLabel.replace('{0}', label) : label);
    const rows: Array<[string, string, string]> = [];
    if (quota?.fiveHour !== undefined)
      rows.push([this.formats.percent(quota.fiveHour), name(s.fiveHour), 'np-s-five']);
    if (quota?.weekly !== undefined)
      rows.push([this.formats.percent(quota.weekly), name(s.weekly), 'np-s-week']);
    for (const hit of data.limitHits) {
      if (hit.time < bucket.start || hit.time >= bucket.start + data.bucketMs) continue;
      const five = hit.limit === 'fiveHour';
      rows.push([
        this.formats.clock(hit.time),
        s.limitReachedAt.replace('{0}', five ? s.fiveHour : s.weekly),
        five ? 'np-s-five' : 'np-s-week',
      ]);
    }
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

  private momentHeading(moment: Moment): string {
    const data = this.data!;
    // Within about a day the hour says enough, as for a column.
    return data.to - data.from > 26 * 3_600_000
      ? this.formats.dayClock(moment.time)
      : this.formats.clock(moment.time);
  }

  /** The quota and the sessions working at a point of the lines. */
  private momentRows(moment: Moment): Array<[string, string, string]> {
    const s = this.strings;
    const name = (label: string) =>
      moment.estimated ? s.estimatedLabel.replace('{0}', label) : label;
    const rows: Array<[string, string, string]> = [];
    if (moment.fiveHour !== undefined)
      rows.push([this.formats.percent(moment.fiveHour), name(s.fiveHour), 'np-s-five']);
    // Short of where the week ahead runs out it isn't at 100% yet, however close.
    if (moment.ahead && moment.weekly !== undefined && moment.weekly < 100) {
      rows.push([this.formats.percent(Math.min(moment.weekly, 99)), name(s.weekly), 'np-s-week']);
    } else if (moment.weekly !== undefined)
      rows.push([this.formats.percent(moment.weekly), name(s.weekly), 'np-s-week']);
    for (const limit of moment.limits) {
      const five = limit === 'fiveHour';
      rows.push([
        this.formats.clock(moment.time),
        s.limitReachedAt.replace('{0}', five ? s.fiveHour : s.weekly),
        five ? 'np-s-five' : 'np-s-week',
      ]);
    }
    const runsOut = this.data!.pace?.week.runsOut;
    if (moment.ahead === 'runsOut') {
      rows.push([this.formats.clock(moment.time), s.runsOutAtPace, 'np-s-week']);
    } else if (moment.ahead === 'reset') {
      rows.push([this.formats.clock(moment.time), s.weeklyReset, '']);
    } else if (moment.ahead && moment === this.moments.quota.at(-1) && runsOut !== undefined) {
      // Where the axis ends first, when the week runs out past it.
      if (runsOut > moment.time) {
        rows.push([this.formats.dayClock(runsOut), s.runsOutAtPace, 'np-s-week']);
      }
    }
    // No session works in the week ahead yet.
    if (!moment.ahead) rows.push([String(moment.sessions), s.sessions, 'np-s-sessions']);
    return rows;
  }

  private describeMoment(moment: Moment): string[] {
    return [
      this.momentHeading(moment),
      ...this.momentRows(moment).map(([value, label]) => `${label} ${value}`),
    ];
  }

  private fillTooltip(heading: string, rows: Array<[string, string, string]>): void {
    const title = document.createElement('div');
    title.className = 'np-tooltip-title';
    title.textContent = heading;
    const list = document.createElement('div');
    list.className = 'np-tooltip-rows';
    for (const [value, label, className] of rows) {
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

/** Where an arrow, Home or End key moves from `at` among `0…last`; from nowhere, to the latest. */
function stepTo(key: string, at: number | undefined, last: number): number | undefined {
  if (key === 'Home') return 0;
  if (key === 'End') return last;
  const move = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
  if (move === 0) return undefined;
  return at === undefined ? last : Math.min(Math.max(at + move, 0), last);
}

/** The lanes drawn as lines, whose points the crosshair can take. */
type LineLane = 'quota' | 'sessions';

/** A point of the quota or sessions lines the crosshair can take, with what was so then. */
export interface Moment {
  time: number;
  fiveHour?: number;
  weekly?: number;
  /** Whether the quota is estimated. */
  estimated: boolean;
  /** The limits Claude Code logged as run out then. */
  limits: Array<LimitHit['limit']>;
  /** The sessions working then. */
  sessions: number;
  /** From now on, along the week ahead at the present pace; there it may run out or reset. */
  ahead?: 'pace' | 'runsOut' | 'reset';
}

/**
 * The points of the lines within the window, oldest first. For the quota lane: each reading, each
 * estimated point and each limit that ran out; where an estimate drops at a reset, the value it
 * drops from; then the week ahead. For the sessions lane: each change in the sessions working at
 * once.
 */
export function chartMoments(
  data: TimelineData,
  forecast?: WeeklyForecast,
): Record<LineLane, Moment[]> {
  const inside = (time: number) => time >= data.from && time <= data.to;
  const sessionsAt = (time: number) => lastAt(data.sessions, time)?.count ?? 0;
  const quota = new Map<number, Moment>();
  const add = (point: QuotaPoint, estimated: boolean) =>
    quota.set(point.time, {
      time: point.time,
      fiveHour: point.fiveHour,
      weekly: point.weekly,
      estimated,
      limits: [],
      sessions: sessionsAt(point.time),
    });
  for (const point of data.quotaEstimate ?? []) {
    if (inside(point.time) && !quota.has(point.time)) add(point, true);
  }
  for (const point of data.quota) {
    if (inside(point.time) && (point.fiveHour !== undefined || point.weekly !== undefined))
      add(point, false);
  }
  // The quota at a time between points: the reading before it, or the estimate before them.
  const quotaThen = (time: number) => {
    const recorded = lastAt(data.quota, time);
    const point = recorded ?? lastAt(data.quotaEstimate ?? [], time);
    return {
      fiveHour: point?.fiveHour,
      weekly: point?.weekly,
      estimated: !recorded && point !== undefined,
    };
  };
  for (const hit of data.limitHits) {
    if (!inside(hit.time)) continue;
    let moment = quota.get(hit.time);
    if (!moment) {
      moment = {
        time: hit.time,
        ...quotaThen(hit.time),
        limits: [],
        sessions: sessionsAt(hit.time),
      };
      quota.set(hit.time, moment);
    }
    if (!moment.limits.includes(hit.limit)) moment.limits.push(hit.limit);
  }
  // A reading taken now says more than the week ahead does.
  for (const moment of forecast ? aheadMoments(data, forecast) : []) {
    if (!quota.has(moment.time)) quota.set(moment.time, moment);
  }
  const sessions = data.sessions
    .filter((step) => inside(step.time))
    .map((step) => ({
      time: step.time,
      ...quotaThen(step.time),
      limits: [],
      sessions: step.count,
    }));
  return { quota: [...quota.values()].sort((a, b) => a.time - b.time), sessions };
}

/**
 * The week ahead from now: a point a column apart, as the columns before now are, and where it
 * runs out and where it ends, each at the percent its line reaches there.
 */
function aheadMoments(data: TimelineData, forecast: WeeklyForecast): Moment[] {
  const { points } = forecast;
  const along = (time: number) => {
    const next = points.findIndex(([at]) => at >= time);
    if (next <= 0) return points.at(next)![1];
    const [t0, v0] = points[next - 1];
    const [t1, v1] = points[next];
    return v0 + ((v1 - v0) * (time - t0)) / (t1 - t0);
  };
  const week = data.pace!.week;
  const [stop] = points[points.length - 1];
  const moments = new Map<number, Moment>();
  const add = (time: number, ahead: Moment['ahead']) =>
    moments.set(time, {
      time,
      weekly: along(time),
      estimated: true,
      limits: [],
      sessions: 0,
      ahead,
    });
  add(data.to, 'pace');
  const origin = data.buckets[0]?.start ?? data.from;
  if (data.bucketMs > 0) {
    const first = origin + (Math.floor((data.to - origin) / data.bucketMs) + 1) * data.bucketMs;
    for (let time = first; time < stop; time += data.bucketMs) add(time, 'pace');
  }
  if (week.runsOut !== undefined && week.runsOut > data.to && week.runsOut < stop) {
    add(week.runsOut, 'runsOut');
  }
  add(stop, stop === week.resetsAt ? 'reset' : 'pace');
  return [...moments.values()].sort((a, b) => a.time - b.time);
}

/** The last of points sorted by time at or before `time`. */
function lastAt<T extends { time: number }>(points: readonly T[], time: number): T | undefined {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (points[middle].time <= time) low = middle + 1;
    else high = middle;
  }
  return low > 0 ? points[low - 1] : undefined;
}

export interface WeeklyForecast {
  /**
   * Where the time axis ends: a third of the window shown past now, so the time before now keeps
   * three quarters of the width however far it is zoomed in; the reset, for the whole of this
   * quota week.
   */
  end: number;
  /** From the last reading through now to the reset or the end, as [time, percent]. */
  points: Array<[number, number]>;
}

/**
 * Where the weekly quota heads at the pace of the last 7 days, while the window shown reaches
 * the present: to the reset, or the end of the axis if that comes first, never past 100%.
 */
export function weeklyForecast(data: TimelineData): WeeklyForecast | undefined {
  const { pace } = data;
  const week = pace?.week;
  // A quota week gone by ends before now: nothing leads on from it.
  if (!week || data.to < data.extent.to || data.extent.to < pace.now || week.resetsAt <= data.to)
    return undefined;
  // The whole of this quota week runs to its reset.
  const end =
    data.range === 'week' && data.from <= data.extent.from
      ? Math.max(data.week.to, data.to)
      : data.to + (data.to - data.from) / 3;
  const stop = Math.min(week.resetsAt, end);
  const points: Array<[number, number]> = [];
  const last = [...data.quota]
    .reverse()
    .find((point) => point.weekly !== undefined && point.time <= data.to);
  // A reading from before a reset doesn't lead on to this week.
  if (last && !(last.weeklyReset !== undefined && last.weeklyReset <= data.to)) {
    points.push([last.time, last.weekly!]);
  }
  points.push([data.to, Math.min(week.used, 100)]);
  if (week.runsOut !== undefined && week.runsOut > data.to && week.runsOut < stop) {
    points.push([week.runsOut, 100], [stop, 100]);
  } else {
    points.push([stop, Math.min(100, week.used + (week.pace * (stop - data.to)) / DAY)]);
  }
  return { end, points };
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
 * reset between two of them. Where Nightpace wasn't running, what can be worked out is still
 * observed: a usage share only falls at a reset, so one that is the same on both sides of the
 * silence held all along, and a window that opened in it was empty until it opened (its reset
 * says when). The rest of a silence is unrecorded, drawn apart.
 */
export function quotaPath(
  points: readonly QuotaPoint[],
  key: 'fiveHour' | 'weekly',
  resetKey: 'fiveHourReset' | 'weeklyReset',
  /** How long the window lasts once it opens. */
  span: number,
  x: (time: number) => number,
  y: (value: number) => number,
): { observed: string; unrecorded: string } {
  let observed = '';
  let unrecorded = '';
  let previous: QuotaPoint | undefined;
  for (const point of points) {
    const value = point[key];
    if (value === undefined) {
      previous = undefined;
      continue;
    }
    if (!previous) {
      observed += `M${x(point.time)},${y(value)}`;
      previous = point;
      continue;
    }
    let from = { time: previous.time, value: previous[key]! };
    const reset = previous[resetKey];
    if (reset !== undefined && reset <= point.time) {
      observed += `L${x(reset)},${y(from.value)}V${y(0)}`;
      from = { time: reset, value: 0 };
    }
    const opened = (point[resetKey] ?? Infinity) - span;
    if (from.value === 0 && opened > from.time && opened < point.time) {
      observed += `L${x(opened)},${y(0)}`;
      from = { time: opened, value: 0 };
    }
    const silence = point.time - from.time;
    // Held all along: no reset in between, and too short for a window to open and close unseen.
    if (silence <= QUOTA_GAP_MS || (value === from.value && silence < span)) {
      observed += `L${x(point.time)},${y(value)}`;
    } else {
      unrecorded += `M${x(from.time)},${y(from.value)}L${x(point.time)},${y(value)}`;
      observed += `M${x(point.time)},${y(value)}`;
    }
    previous = point;
  }
  return { observed, unrecorded };
}
