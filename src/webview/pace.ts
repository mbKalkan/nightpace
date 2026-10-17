// Where the plan's limits are heading: the week at the pace of the last 7 days, with what a day
// can take to last, and how long this 5-hour window lasts with one to five sessions at once.
// Every figure is estimated from the user's own quota readings, and says so.
import {
  NO_EFFORT,
  PLANNED_SESSIONS,
  type Pace,
  type PanelStrings,
  type RatePoint,
  type SessionRate,
} from '../shared/protocol';
import { rateTrend, type RateTrendInput } from './chart/rateTrend';
import type { Formats } from './format';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export class PaceCards {
  readonly element = document.createElement('div');
  private readonly week = document.createElement('section');
  private readonly window = document.createElement('section');
  private pace: Pace | undefined;
  /** Where each card's trend goes once the card is laid out and its width known. */
  private trends: Array<{ place: HTMLElement; draw: (width: number) => SVGSVGElement }> = [];
  private width = 0;

  constructor(
    private readonly strings: PanelStrings,
    private readonly formats: Formats,
  ) {
    this.element.className = 'np-pace';
    this.element.hidden = true;
    this.week.className = 'np-card np-pace-card';
    this.week.setAttribute('aria-labelledby', 'np-week-title');
    this.window.className = 'np-card np-pace-card';
    this.window.setAttribute('aria-labelledby', 'np-window-title');
    this.element.append(this.week, this.window);
    // The trends are drawn to the width of their card.
    new ResizeObserver(() => {
      if (this.week.clientWidth !== this.width) this.drawTrends();
    }).observe(this.week);
  }

  render(pace: Pace | undefined): void {
    this.pace = pace;
    this.element.hidden = !pace;
    if (!pace) return;
    this.trends = [];
    this.renderWeek(pace);
    this.renderWindow(pace);
    this.drawTrends();
  }

  private drawTrends(): void {
    this.width = this.week.clientWidth;
    if (!this.pace) return;
    for (const { place, draw } of this.trends) {
      if (place.clientWidth > 0) place.replaceChildren(draw(place.clientWidth));
    }
  }

  private header(id: string, title: string, learning: boolean): HTMLElement {
    const header = document.createElement('div');
    header.className = 'np-card-header';
    const heading = document.createElement('h2');
    heading.id = id;
    heading.className = 'np-card-title';
    heading.textContent = title;
    header.append(heading);
    if (learning) {
      const badge = document.createElement('span');
      badge.className = 'np-badge';
      badge.textContent = this.strings.learning;
      badge.title = this.strings.learningHint;
      header.append(badge);
    }
    return header;
  }

  private figures(items: Array<[string, string]>): HTMLElement {
    const list = document.createElement('dl');
    list.className = 'np-figures np-pace-figures';
    for (const [label, value] of items) {
      const figure = document.createElement('div');
      figure.className = 'np-figure';
      const term = document.createElement('dt');
      term.textContent = label;
      const amount = document.createElement('dd');
      amount.textContent = value;
      figure.append(term, amount);
      list.append(figure);
    }
    return list;
  }

  private note(text: string, className = 'np-note-text'): HTMLParagraphElement {
    const note = document.createElement('p');
    note.className = className;
    note.textContent = text;
    return note;
  }

  private rateName(rate: SessionRate): string {
    const model = this.strings.models[rate.family];
    return rate.effort === NO_EFFORT ? model : `${model} ${rate.effort}`;
  }

  private renderWeek(pace: Pace): void {
    const s = this.strings;
    const f = this.formats;
    const { week } = pace;
    const children: HTMLElement[] = [
      this.header('np-week-title', s.weekTitle, pace.learning),
      this.figures([
        [s.used, f.percent(week.used)],
        [s.resets, f.dayClock(week.resetsAt)],
        week.runsOut !== undefined
          ? [s.runsOutAtPace, f.dayClock(week.runsOut)]
          : [s.atResetAtPace, f.percent(week.atReset)],
      ]),
      this.meter('np-s-week', week.used, week.atReset),
      this.note(s.paceNote.replace('{0}', f.percent(week.pace))),
    ];
    if (week.budget <= 0) {
      children.push(this.note(s.budgetSpent));
    } else if (pace.rates.length > 0) {
      // Within its last day the week has what is left rather than a day's share.
      const days = Math.min(1, (week.resetsAt - pace.now) / DAY);
      // More than a day holds, or than is left before the reset, is no limit at all.
      const limit = days * 24;
      const caption = (days < 1 ? s.budgetLeftCaption : s.budgetCaption).replace(
        '{0}',
        f.percent(week.budget * days),
      );
      children.push(
        this.rateTable(
          pace,
          caption,
          (rate, sessions) => {
            const hours = (week.budgetHours[rate] * days) / sessions;
            return hours >= limit ? undefined : f.duration(hours * HOUR);
          },
          days < 1 ? s.lasts : s.allDay,
        ),
      );
    }
    children.push(this.trend(pace, pace.history.weekly, pace.weeklyPerDollar, 'np-s-week'));
    this.week.replaceChildren(...children);
  }

  private renderWindow(pace: Pace): void {
    const s = this.strings;
    const f = this.formats;
    const { window } = pace;
    const left = window.resetsAt === undefined ? 5 * HOUR : window.resetsAt - pace.now;
    const children: HTMLElement[] = [
      this.header('np-window-title', s.windowTitle, pace.learning),
      this.figures([
        [s.used, f.percent(window.used)],
        [s.resets, window.resetsAt === undefined ? s.windowClosed : f.clock(window.resetsAt)],
        [s.timeLeft, f.duration(left)],
      ]),
      this.meter('np-s-five', window.used, window.used),
    ];
    const [rate] = pace.rates;
    if (rate) {
      children.push(
        this.note(
          s.rateNote
            .replace('{0}', this.rateName(rate))
            .replace('{1}', f.percent(rate.costPerHour * pace.fiveHourPerDollar)),
        ),
        this.rateTable(
          pace,
          s.lastsCaption,
          (index, sessions) => {
            const lasts = window.lasts[index][sessions - 1];
            return lasts === null ? undefined : f.duration(lasts);
          },
          s.lasts,
        ),
      );
    }
    children.push(this.trend(pace, pace.history.fiveHour, pace.fiveHourPerDollar, 'np-s-five'));
    this.window.replaceChildren(...children);
  }

  /** Used so far, and on to the reset at this pace in a lighter step: a bar to 100%. */
  private meter(series: string, used: number, ahead: number): HTMLElement {
    const track = document.createElement('div');
    track.className = `np-meter ${series}`;
    track.setAttribute('aria-hidden', 'true');
    const usedBar = document.createElement('span');
    usedBar.className = 'np-meter-used';
    usedBar.style.width = `${Math.min(used, 100)}%`;
    const aheadBar = document.createElement('span');
    aheadBar.className = 'np-meter-ahead';
    aheadBar.style.width = `${Math.max(0, Math.min(ahead, 100) - Math.min(used, 100))}%`;
    track.append(usedBar, aheadBar);
    return track;
  }

  /**
   * At the foot of a card, the ground for every figure above it: what 1% of the limit is at API
   * prices, measured, and how much of it an hour of the main kind of session took over time.
   */
  private trend(pace: Pace, points: RatePoint[], perDollar: number, series: string): HTMLElement {
    const s = this.strings;
    const f = this.formats;
    const block = document.createElement('div');
    block.className = 'np-pace-foot';
    const header = document.createElement('div');
    header.className = 'np-trend-header';
    const [rate] = pace.rates;
    // Without a kind of session worked long enough to know what its hour costs, the chart follows
    // what 1% of the limit is at API prices: the same measure, the other way up.
    const shown: Pick<RateTrendInput, 'value' | 'format' | 'axis' | 'describe'> = rate
      ? {
          value: (point) => point.perDollar * rate.costPerHour,
          format: (value) => f.fine(value),
          describe: (point) =>
            s.trendPoint
              .replace('{0}', f.window(point.from, point.to))
              .replace('{1}', this.rateName(rate))
              .replace('{2}', f.fine(point.perDollar * rate.costPerHour))
              .replace('{3}', f.money(1 / point.perDollar)),
        }
      : {
          value: (point) => 1 / point.perDollar,
          format: (value) => f.money(value),
          axis: (top) => f.axisMoney(top),
          describe: (point) =>
            s.trendCostPoint
              .replace('{0}', f.window(point.from, point.to))
              .replace('{1}', f.money(1 / point.perDollar)),
        };
    const title = document.createElement('span');
    title.className = 'np-trend-title';
    title.textContent = rate ? s.trendTitle.replace('{0}', this.rateName(rate)) : s.trendCostTitle;
    title.title = s.trendHint;
    const estimate = document.createElement('span');
    estimate.className = 'np-note-text';
    estimate.textContent = s.trendEstimate.replace('{0}', f.money(1 / perDollar));
    estimate.title = s.trendHint;
    header.append(title, estimate);
    block.append(header);
    const place = document.createElement('div');
    place.className = 'np-trend-place';
    block.append(place);
    this.trends.push({
      place,
      draw: (width) =>
        rateTrend({
          ...shown,
          points,
          now: pace.now,
          width,
          tick: (time, step) => f.tick(time, step),
          series,
          empty: s.trendEmpty,
        }),
    });
    return block;
  }

  /**
   * A row for each kind of session and a column for each number of sessions at once. A cell
   * without a value shows `none`, muted: it lasts, or takes the whole day.
   */
  private rateTable(
    pace: Pace,
    title: string,
    value: (rate: number, sessions: number) => string | undefined,
    none: string,
  ): HTMLElement {
    const s = this.strings;
    const f = this.formats;
    const table = document.createElement('table');
    table.className = 'np-table np-lasts-table';
    const caption = document.createElement('caption');
    caption.className = 'np-pace-caption';
    caption.textContent = title;
    const headRow = document.createElement('tr');
    const corner = document.createElement('th');
    corner.scope = 'col';
    corner.className = 'np-text-cell';
    corner.textContent = s.sessionsAtOnce;
    headRow.append(corner);
    for (let count = 1; count <= PLANNED_SESSIONS; count++) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = String(count);
      headRow.append(cell);
    }
    const head = document.createElement('thead');
    head.append(headRow);
    const body = document.createElement('tbody');
    pace.rates.forEach((rate, index) => {
      const row = document.createElement('tr');
      const name = document.createElement('th');
      name.scope = 'row';
      name.className = 'np-text-cell';
      name.textContent = this.rateName(rate);
      name.title = s.rateHint
        .replace('{0}', f.money(rate.costPerHour))
        .replace('{1}', f.duration(rate.hours * HOUR))
        .replace('{2}', f.percent(rate.costPerHour * pace.fiveHourPerDollar))
        .replace('{3}', f.share((rate.costPerHour * pace.weeklyPerDollar) / 100));
      row.append(name);
      for (let sessions = 1; sessions <= PLANNED_SESSIONS; sessions++) {
        const cell = document.createElement('td');
        const text = value(index, sessions);
        cell.textContent = text ?? none;
        if (text === undefined) cell.className = 'np-lasts';
        row.append(cell);
      }
      body.append(row);
    });
    table.append(caption, head, body);
    // A narrow panel scrolls the table rather than the page.
    const scroll = document.createElement('div');
    scroll.className = 'np-table-scroll np-pace-table';
    scroll.append(table);
    return scroll;
  }
}
