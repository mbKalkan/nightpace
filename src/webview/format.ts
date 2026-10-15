// Numbers and times as the panel shows them, in the VS Code display language. Times are always
// on a 24-hour clock (D-006).

const clock = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const;

export class Formats {
  private readonly time: Intl.DateTimeFormat;
  private readonly dayTime: Intl.DateTimeFormat;
  private readonly dateTime: Intl.DateTimeFormat;
  private readonly day: Intl.DateTimeFormat;
  private readonly date: Intl.DateTimeFormat;
  private readonly compact: Intl.NumberFormat;
  private readonly hours: Intl.NumberFormat;
  private readonly minutes: Intl.NumberFormat;

  constructor(locale: string) {
    this.time = new Intl.DateTimeFormat(locale, clock);
    this.dayTime = new Intl.DateTimeFormat(locale, { weekday: 'short', ...clock });
    this.dateTime = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', ...clock });
    this.day = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric' });
    this.date = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
    this.compact = new Intl.NumberFormat(locale, {
      notation: 'compact',
      maximumFractionDigits: 1,
    });
    this.hours = new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'hour',
      unitDisplay: 'narrow',
    });
    this.minutes = new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'minute',
      unitDisplay: 'narrow',
    });
  }

  /** `14:30` */
  clock(time: number): string {
    return this.time.format(time);
  }

  /** `Thu 14:30` */
  dayClock(time: number): string {
    return this.dayTime.format(time);
  }

  /** `Oct 15, 14:30` */
  dateClock(time: number): string {
    return this.dateTime.format(time);
  }

  /** `Oct 15, 08:30 – 20:40`, with the second date only when it differs. */
  window(from: number, to: number): string {
    const sameDay = new Date(from).toDateString() === new Date(to).toDateString();
    return `${this.dateClock(from)} – ${sameDay ? this.clock(to) : this.dateClock(to)}`;
  }

  /** An axis label: the hour within a day, the day within a week, the date within a month. */
  tick(time: number, step: number): string {
    const DAY = 86_400_000;
    if (step < DAY) return this.time.format(time);
    if (step < 7 * DAY) return this.day.format(time);
    return this.date.format(time);
  }

  /** `1.2M` */
  amount(value: number): string {
    return this.compact.format(value);
  }

  /** `2h 15m`, to the minute. */
  duration(ms: number): string {
    const total = Math.round(ms / 60_000);
    const [h, m] = [Math.floor(total / 60), total % 60];
    if (h === 0) return this.minutes.format(m);
    return m === 0 ? this.hours.format(h) : `${this.hours.format(h)} ${this.minutes.format(m)}`;
  }

  /** A share from 0 to 1 as a whole percentage, with `<1%` for a sliver. */
  share(value: number): string {
    return value > 0 && value < 0.005 ? '<1%' : this.percent(value * 100);
  }

  percent(value: number): string {
    return `${Math.round(value)}%`;
  }
}
