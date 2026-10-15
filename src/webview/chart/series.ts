// The series the token lane stacks: model families, effort levels or token types, in dollars
// or tokens, with their labels and colors. The chart, its tooltip and the table all take them
// from here.
import {
  EFFORT_LEVELS,
  NO_EFFORT,
  TOKEN_TYPES,
  type ModelFamily,
  type PanelStrings,
  type TimelineData,
  type TokenBucket,
  type TokenMeasure,
  type TokenSplit,
  type TokenType,
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

export function typeClass(type: TokenType): string {
  return `np-t-${type}`;
}

export function effortLabel(effort: string, strings: PanelStrings): string {
  return effort === NO_EFFORT ? strings.noEffort : effort;
}

/** The series in stacking order, bottom first. */
export function tokenSeries(
  data: TimelineData,
  split: TokenSplit,
  measure: TokenMeasure,
  strings: PanelStrings,
): TokenSeries[] {
  if (split === 'effort') {
    return data.efforts.map((effort) => ({
      label: effortLabel(effort, strings),
      className: effortClass(effort),
      value: (bucket) => bucket[measure].byEffort[effort] ?? 0,
    }));
  }
  if (split === 'type') {
    return TOKEN_TYPES.filter((type) =>
      data.buckets.some((bucket) => bucket.tokens.byType[type]),
    ).map((type) => ({
      label: strings.tokenTypes[type],
      className: typeClass(type),
      value: (bucket) => bucket[measure].byType[type] ?? 0,
    }));
  }
  return data.models.map((model) => ({
    label: strings.models[model],
    className: modelClass(model),
    value: (bucket) => bucket[measure].byModel[model] ?? 0,
  }));
}
