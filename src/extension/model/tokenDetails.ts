// The tokens of a window by kind, with what they would have cost at API list prices, and what
// the same requests would have cost without the prompt cache.
import { TOKEN_DETAILS, type TokenDetails } from '../../shared/protocol';
import { requestCost } from './pricing';
import type { TimelineRequest } from './timeline';

export function emptyTokenDetails(): TokenDetails {
  const details = { thinking: { tokens: 0, cost: 0 }, uncachedCost: 0 } as TokenDetails;
  for (const key of TOKEN_DETAILS) details[key] = { tokens: 0, cost: 0 };
  return details;
}

/** Of the requests made within [from, to). Requests of models without a known price add no cost. */
export function tokenDetails(
  requests: Iterable<TimelineRequest>,
  from: number,
  to: number,
): TokenDetails {
  const details = emptyTokenDetails();
  for (const request of requests) {
    if (request.time < from || request.time >= to) continue;
    const { tokens } = request;
    const cost = requestCost(request);
    for (const key of TOKEN_DETAILS) {
      details[key].tokens += tokens[key];
      details[key].cost += cost?.[key] ?? 0;
    }
    details.thinking.tokens += tokens.thinking;
    details.thinking.cost += cost?.thinking ?? 0;
    if (!cost) continue;
    // Every cached token sent again as plain input instead.
    const uncached = requestCost({
      ...request,
      tokens: {
        ...tokens,
        input: tokens.input + tokens.cacheWrite5m + tokens.cacheWrite1h + tokens.cacheRead,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        cacheRead: 0,
      },
    });
    details.uncachedCost += uncached?.total ?? 0;
  }
  return details;
}
