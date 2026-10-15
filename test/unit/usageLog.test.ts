import { describe, expect, it } from 'vitest';
import type { UsageEvent } from '../../src/extension/transcripts/events';
import { UsageLog } from '../../src/extension/transcripts/usageLog';

const request = (overrides: Partial<UsageEvent> & { output?: number } = {}): UsageEvent => {
  const { output = 100, ...rest } = overrides;
  return {
    kind: 'usage',
    requestId: 'req_1',
    sessionId: 's1',
    time: 1000,
    model: 'claude-opus-5-5',
    sidechain: false,
    final: true,
    tokens: { input: 1, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output, thinking: 0 },
    ...rest,
  };
};

const only = (log: UsageLog) => {
  expect(log.size).toBe(1);
  return [...log.usage()][0];
};

describe('UsageLog', () => {
  it('completes a streamed request with its final line, keeping its start time', () => {
    const log = new UsageLog();
    log.add(request({ final: false, output: 10, time: 1000 }));
    log.add(request({ final: false, output: 10, time: 1001 }));
    log.add(request({ final: true, output: 400, time: 1009 }));
    expect(only(log)).toMatchObject({
      final: true,
      time: 1000,
      end: 1009,
      tokens: { output: 400 },
    });
    expect(only(log)).not.toHaveProperty('kind');
  });

  it('keeps the final counts when an unfinished line comes later', () => {
    const log = new UsageLog();
    log.add(request({ final: true, output: 400, time: 1009 }));
    log.add(request({ final: false, output: 10, time: 1000 }));
    expect(only(log)).toMatchObject({ final: true, time: 1000, tokens: { output: 400 } });
  });

  it('keeps the largest count of a request that never finished', () => {
    const log = new UsageLog();
    log.add(request({ final: false, output: 8 }));
    log.add(request({ final: false, output: 30 }));
    log.add(request({ final: false, output: 12 }));
    expect(only(log)).toMatchObject({ final: false, tokens: { output: 30 } });
  });

  it('leaves a copied request with the session that made it', () => {
    const log = new UsageLog();
    log.add(request({ sessionId: 'original', project: '/a' }));
    log.add(request({ sessionId: 'fork', project: '/b' }));
    expect(only(log)).toMatchObject({ sessionId: 'original', project: '/a' });
  });

  it('records each refused request once', () => {
    const log = new UsageLog();
    const limit = { kind: 'limit', sessionId: 's1', time: 5, limit: 'five_hour' } as const;
    log.add(limit);
    log.add({ ...limit });
    log.add({ ...limit, time: 6 });
    expect(log.limits).toHaveLength(2);
    expect(log.size).toBe(0);
  });
});
