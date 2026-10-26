// Which Claude account a quota reading belongs to. Each account has a quota of its own, so
// readings and requests of different accounts are kept apart.

export interface AccountId {
  email: string;
  /** One email can belong to a personal plan and to a team's, each with its own quota. */
  organization?: string;
}

/** The same string for the same account, whatever the case of its email. */
export function accountKey(account: AccountId): string {
  return JSON.stringify([account.email.toLowerCase(), account.organization ?? '']);
}

/** The account in Claude Code's reply to the SDK's `initialize` request. */
export function parseInitializeAccount(response: unknown): AccountId | undefined {
  if (!isObject(response) || !isObject(response.account)) return undefined;
  return accountOf(response.account.email, response.account.organization);
}

/**
 * The account Claude Code is signed in to, from its global config file (`.claude.json`). Only
 * read to notice a switch quickly; the reading itself says which account it is.
 */
export function parseConfigAccount(config: unknown): AccountId | undefined {
  if (!isObject(config) || !isObject(config.oauthAccount)) return undefined;
  return accountOf(config.oauthAccount.emailAddress, config.oauthAccount.organizationName);
}

function accountOf(email: unknown, organization: unknown): AccountId | undefined {
  if (typeof email !== 'string' || !email.trim()) return undefined;
  const account: AccountId = { email: email.trim() };
  if (typeof organization === 'string' && organization.trim()) {
    account.organization = organization.trim();
  }
  return account;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
