import { describe, expect, it } from 'vitest';
import type { QuotaSnapshot } from '../../src/extension/quota/snapshot';
import { quotaText } from '../../src/extension/quotaText';
import type { Translate } from '../../src/extension/texts';

const english: Translate = (message, ...args) =>
  message.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)]));

// Times in UTC, shown in the test's time zone: compare with the same formatter.
const now = Date.UTC(2026, 9, 15, 11, 0);
const hm = (time: number) =>
  new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    time,
  );

const snapshot = (overrides: Partial<QuotaSnapshot> = {}): QuotaSnapshot => ({
  time: now - 60_000,
  available: true,
  plan: 'max',
  fiveHour: { percent: 63.4, resetsAt: now + 3 * 3600_000 },
  weekly: { percent: 41, resetsAt: now + 3 * 86_400_000 },
  models: [{ model: 'Fable', percent: 12, resetsAt: now + 3 * 86_400_000 }],
  ...overrides,
});

describe('quotaText', () => {
  it('shows both limits, when the five-hour window resets and how long the week has left', () => {
    const text = quotaText(snapshot(), now, english, 'en')!;
    expect(text.text).toBe(`5h 63% ↻${hm(now + 3 * 3600_000)} · Wk 41% ↻3d`);
    expect(text.level).toBe('normal');
    expect(text.tooltip[0]).toBe(`5-hour limit: 63% used, resets at ${hm(now + 3 * 3600_000)}`);
    expect(text.tooltip[1]).toMatch(/^Weekly limit: 41% used, resets /);
    expect(text.tooltip[2]).toBe('Fable weekly limit: 12% used');
    expect(text.tooltip[3]).toBe(`Updated at ${hm(now - 60_000)}`);
  });

  it('shows times on a 24-hour clock in every locale', () => {
    // 21:30 in any time zone from UTC-9 to UTC+2 is past noon.
    const evening = Date.UTC(2026, 9, 15, 21, 30);
    for (const locale of ['en-US', 'en', 'tr']) {
      const text = quotaText(
        snapshot({ time: now, fiveHour: { percent: 5, resetsAt: evening } }),
        now,
        english,
        locale,
      )!;
      expect(text.text, locale).toMatch(/^5h 5% ↻\d{2}:\d{2} · /);
      expect([text.text, ...text.tooltip].join(' '), locale).not.toMatch(/AM|PM|ÖÖ|ÖS/);
    }
  });

  it("doesn't show a window whose reset time has passed", () => {
    const text = quotaText(
      snapshot({ fiveHour: { percent: 90, resetsAt: now - 1 } }),
      now,
      english,
      'en',
    )!;
    expect(text.text).toBe('5h — · Wk 41% ↻3d');
    expect(text.level).toBe('normal');
  });

  it('counts the week down in days and hours, then hours, then minutes', () => {
    const left = (ms: number) =>
      quotaText(
        snapshot({ weekly: { percent: 41, resetsAt: now + ms } }),
        now,
        english,
        'en',
      )!.text.split('Wk 41% ')[1];
    const HOUR = 3600_000;
    expect(left(4 * 24 * HOUR + 9 * HOUR + 59 * 60_000)).toBe('↻4d 9h');
    expect(left(24 * HOUR)).toBe('↻1d');
    expect(left(23 * HOUR + 30 * 60_000)).toBe('↻23h');
    expect(left(40 * 60_000)).toBe('↻40m');
    // Without a reset, nothing to count.
    expect(quotaText(snapshot({ weekly: { percent: 41 } }), now, english, 'en')!.text).toMatch(
      / · Wk 41%$/,
    );
  });

  it('warns as a limit gets close, per-model limits included', () => {
    expect(quotaText(snapshot({ weekly: { percent: 80 } }), now, english, 'en')?.level).toBe(
      'warning',
    );
    const models = [{ model: 'Fable', percent: 97 }];
    expect(quotaText(snapshot({ models }), now, english, 'en')?.level).toBe('error');
  });

  it('shows nothing when no plan limits apply', () => {
    expect(quotaText(snapshot({ available: false }), now, english, 'en')).toBeUndefined();
  });
});
