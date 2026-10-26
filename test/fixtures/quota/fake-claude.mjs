// Stands in for Claude Code's SDK mode in tests: answers `initialize` and `get_usage` the way it
// does. FAKE_CLAUDE picks the behavior: reply (default), refuse, silent, crash, and old (an older
// Claude Code that refuses `initialize`). FAKE_CLAUDE_EMAIL names the account; CLAUDE_CONFIG_DIR,
// when set, becomes its organization, so a test can tell which folder was asked.
import { createInterface } from 'node:readline';

const mode = process.env.FAKE_CLAUDE ?? 'reply';
const write = (message) => process.stdout.write(JSON.stringify(message) + '\n');

if (mode === 'crash') {
  process.stderr.write('Not logged in\n');
  process.exit(1);
}

// Claude Code says other things first; one of them mentions the request id without answering it.
write({ type: 'system', subtype: 'init', session_id: 'fake' });

for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (message.type !== 'control_request') continue;
  const id = message.request_id;
  if (mode === 'silent') continue;
  write({ type: 'system', subtype: 'status', note: `working on ${id}` });
  if (mode === 'refuse') {
    write({
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: id,
        error: 'Unsupported control request subtype: get_usage',
      },
    });
    continue;
  }
  if (message.request?.subtype === 'initialize') {
    write({
      type: 'control_response',
      response:
        mode === 'old'
          ? { subtype: 'error', request_id: id, error: 'Unsupported control request subtype' }
          : {
              subtype: 'success',
              request_id: id,
              response: {
                commands: [],
                account: {
                  email: process.env.FAKE_CLAUDE_EMAIL ?? 'someone@example.com',
                  organization: process.env.CLAUDE_CONFIG_DIR ?? 'Personal',
                  subscriptionType: 'Claude Max',
                  apiProvider: 'firstParty',
                },
              },
            },
    });
    continue;
  }
  // Written in two pieces, as a pipe may deliver it.
  const reply = JSON.stringify({
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: id,
      response: {
        subscription_type: 'max',
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 41, resets_at: '2026-10-15T11:30:00.382961+00:00' },
          seven_day: { utilization: 7, resets_at: '2026-10-21T20:00:00+00:00' },
          model_scoped: [
            { display_name: 'Fable', utilization: 2, resets_at: '2026-10-21T20:00:00+00:00' },
          ],
        },
      },
    },
  });
  process.stdout.write(reply.slice(0, 40));
  setTimeout(() => process.stdout.write(reply.slice(40) + '\n'), 20);
}
