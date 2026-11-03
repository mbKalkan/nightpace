// Axis ticks: round values a reader can take in at a glance.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Nominal: ticks this far apart fall on the 1st of a month. */
const MONTH = 30 * DAY;
const TIME_STEPS = [
  5 * MIN,
  10 * MIN,
  15 * MIN,
  30 * MIN,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  5 * DAY,
  7 * DAY,
  MONTH / 2,
  MONTH,
  3 * MONTH,
];

/** Tick times on local minute, hour or midnight boundaries, about `target` of them. */
export function timeTicks(
  from: number,
  to: number,
  target: number,
): { times: number[]; step: number } {
  const step =
    TIME_STEPS.find((candidate) => (to - from) / candidate <= target) ?? TIME_STEPS.at(-1)!;
  if (step >= MONTH / 2) return { times: monthTicks(from, to, step), step };
  const times: number[] = [];
  const start = new Date(from);
  if (step >= DAY) {
    start.setHours(0, 0, 0, 0);
  } else if (step < HOUR) {
    start.setSeconds(0, 0);
    start.setMinutes(Math.ceil(start.getMinutes() / (step / MIN)) * (step / MIN));
  } else {
    start.setMinutes(0, 0, 0);
    start.setHours(Math.ceil(start.getHours() / (step / HOUR)) * (step / HOUR));
  }
  for (const time = new Date(start); time.getTime() <= to;) {
    const day = time.getDate();
    // Days of the month in steps start again on the 1st: a tick too close to the last one goes.
    const last = times[times.length - 1];
    if (
      time.getTime() >= from &&
      (step < DAY || step === DAY || (day - 1) % (step / DAY) === 0) &&
      !(last !== undefined && time.getTime() - last < step / 2)
    ) {
      times.push(time.getTime());
    }
    if (step >= DAY) time.setDate(time.getDate() + 1);
    else time.setTime(time.getTime() + step);
  }
  return { times, step };
}

/** The 1st of each month, or of each quarter's first month, and the 15th too for half months. */
function monthTicks(from: number, to: number, step: number): number[] {
  const every = Math.max(1, Math.round(step / MONTH));
  const days = step < MONTH ? [1, 15] : [1];
  const times: number[] = [];
  const month = new Date(from);
  month.setHours(0, 0, 0, 0);
  month.setDate(1);
  for (; month.getTime() <= to; month.setMonth(month.getMonth() + 1)) {
    if (month.getMonth() % every !== 0) continue;
    for (const day of days) {
      const time = new Date(month.getFullYear(), month.getMonth(), day).getTime();
      if (time >= from && time <= to) times.push(time);
    }
  }
  return times;
}

/** A round maximum and evenly spaced ticks from zero up to it, for a value axis. */
export function valueTicks(max: number, target = 3): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  const ticks: number[] = [];
  for (let value = 0; value < max + step; value += step) ticks.push(value);
  return ticks;
}
