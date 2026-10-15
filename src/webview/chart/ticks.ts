// Axis ticks: round values a reader can take in at a glance.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
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
];

/** Tick times on local minute, hour or midnight boundaries, about `target` of them. */
export function timeTicks(
  from: number,
  to: number,
  target: number,
): { times: number[]; step: number } {
  const step = TIME_STEPS.find((candidate) => (to - from) / candidate <= target) ?? 7 * DAY;
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
    if (time.getTime() >= from && (step < DAY || step === DAY || (day - 1) % (step / DAY) === 0)) {
      times.push(time.getTime());
    }
    if (step >= DAY) time.setDate(time.getDate() + 1);
    else time.setTime(time.getTime() + step);
  }
  return { times, step };
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
