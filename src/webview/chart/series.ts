// The series the token lane stacks: model families or effort levels, with their labels and
// colors. The chart, its tooltip and the table all take them from here.
import {
  EFFORT_LEVELS,
  NO_EFFORT,
  type ModelFamily,
  type PanelStrings,
  type TimelineData,
  type TokenBucket,
  type TokenSplit,
} from '../../shared/protocol';

export interface TokenSeries {
  label: string;
  className: string;
  value: (bucket: TokenBucket) => number;
}

export function modelClass(model: ModelFamily): string {
  return `np-m-${model}`;
}

/** Levels Nightpace doesn't know, and requests without one, are gray. */
export function effortClass(effort: string): string {
  return (EFFORT_LEVELS as readonly string[]).includes(effort) ? `np-e-${effort}` : 'np-e-other';
}

export function effortLabel(effort: string, strings: PanelStrings): string {
  return effort === NO_EFFORT ? strings.noEffort : effort;
}

/** The series in stacking order, bottom first. */
export function tokenSeries(
  data: TimelineData,
  split: TokenSplit,
  strings: PanelStrings,
): TokenSeries[] {
  if (split === 'effort') {
    return data.efforts.map((effort) => ({
      label: effortLabel(effort, strings),
      className: effortClass(effort),
      value: (bucket) => bucket.byEffort[effort] ?? 0,
    }));
  }
  return data.models.map((model) => ({
    label: strings.models[model],
    className: modelClass(model),
    value: (bucket) => bucket.byModel[model] ?? 0,
  }));
}
