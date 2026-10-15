// Numbers and times as the panel shows them, in the VS Code display language. Times are always
// on a 24-hour clock (D-006).

const clock = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const;

export class Formats {
  private readonly time: Intl.DateTimeFormat;
  private readonly dayTime: Intl.DateTimeFormat;
  private readonly day: Intl.DateTimeFormat;
  private readonly date: Intl.DateTimeFormat;
  private readonly compact: Intl.NumberFormat;

  constructor(locale: string) {
    this.time = new Intl.DateTimeFormat(locale, clock);
    this.dayTime = new Intl.DateTimeFormat(locale, { weekday: 'short', ...clock });
    this.day = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric' });
    this.date = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
    this.compact = new Intl.NumberFormat(locale, {
      notation: 'compact',
      maximumFractionDigits: 1,
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

  percent(value: number): string {
    return `${Math.round(value)}%`;
  }
}
