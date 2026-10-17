// A small line chart of how much of a limit an hour of work took, stretch by stretch: it moves
// when Anthropic changes the limits. One series on its own axis; each point says what it was on
// pointing at it.
import type { RatePoint } from '../../shared/protocol';
import { svg } from './svg';
import { timeTicks, valueTicks } from './ticks';

const DAY = 86_400_000;
const HEIGHT = 72;
const TOP = 8;
const BOTTOM = 18;
const LEFT = 36;
const RIGHT = 44;
/** The chart shows at least a week, and at most the four weeks the points come from. */
const MIN_SPAN = 7 * DAY;
const MAX_SPAN = 28 * DAY;

export interface RateTrendInput {
  points: readonly RatePoint[];
  now: number;
  width: number;
  /** The value shown for a point, like the percent of the limit an hour of work took. */
  value: (point: RatePoint) => number;
  format: (value: number) => string;
  /** What a point says when pointed at. */
  describe: (point: RatePoint) => string;
  tick: (time: number, step: number) => string;
  /** The series class, for its color. */
  series: string;
  /** Said across the chart while it has no points. */
  empty: string;
}

export function rateTrend(input: RateTrendInput): SVGSVGElement {
  const { points, now, width, value, format, describe, tick, series, empty } = input;
  const last = points.at(-1);
  const root = svg('svg', {
    width,
    height: HEIGHT,
    class: 'np-trend',
    role: 'img',
    'aria-label': last ? describe(last) : empty,
  });
  const first = points[0]?.to ?? now;
  const from = Math.max(now - MAX_SPAN, Math.min(first - DAY, now - MIN_SPAN));
  const plotRight = width - RIGHT;
  const plotBottom = HEIGHT - BOTTOM;
  const x = (time: number) => LEFT + ((time - from) / (now - from)) * (plotRight - LEFT);
  const values = points.map(value);
  // Without points only the baseline: a scale of nothing would be made up.
  const ticks = last ? valueTicks(Math.max(...values) * 1.15, 2) : [0, 1];
  const top = ticks[ticks.length - 1];
  const y = (v: number) => plotBottom - (v / top) * (plotBottom - TOP);

  for (const v of last ? ticks : [0]) {
    root.append(
      svg('line', { class: 'np-grid', x1: LEFT, x2: plotRight, y1: y(v), y2: y(v) }),
      svg(
        'text',
        { class: 'np-axis-label', x: LEFT - 6, y: y(v) + 4, 'text-anchor': 'end' },
        format(v),
      ),
    );
  }
  // A label about every 80 pixels, and at least five: fewer leave a narrow chart with one.
  const { times, step } = timeTicks(from, now, Math.max(5, Math.floor((plotRight - LEFT) / 80)));
  for (const time of times) {
    root.append(
      svg(
        'text',
        { class: 'np-axis-label', x: x(time), y: HEIGHT - 4, 'text-anchor': 'middle' },
        tick(time, step),
      ),
    );
  }
  if (!last) {
    root.append(
      svg(
        'text',
        {
          class: 'np-axis-label',
          x: (LEFT + plotRight) / 2,
          y: (TOP + plotBottom) / 2 + 4,
          'text-anchor': 'middle',
        },
        empty,
      ),
    );
    return root;
  }

  if (points.length > 1) {
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.to)},${y(value(p))}`).join('');
    root.append(svg('path', { class: `np-line ${series}`, d }));
  }
  points.forEach((point) => {
    const group = svg('g', { class: 'np-trend-point' });
    const cx = x(point.to);
    const cy = y(value(point));
    group.append(
      svg('title', {}, describe(point)),
      svg('circle', { class: 'np-trend-hit', cx, cy, r: 10 }),
      svg('circle', { class: `np-dot ${series}`, cx, cy, r: point === last ? 4.5 : 3.5 }),
    );
    root.append(group);
  });
  root.append(
    svg(
      'text',
      { class: 'np-end-label', x: x(last.to) + 8, y: y(value(last)) + 4 },
      format(value(last)),
    ),
  );
  return root;
}
