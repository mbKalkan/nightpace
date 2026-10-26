import type { AccountOption, PanelStrings, TimelineData } from '../shared/protocol';

/** Chooses which account's usage the panel shows; there only while there is more than one. */
export class AccountChooser {
  readonly element = document.createElement('select');
  /** What the options say, so a refresh that changes nothing leaves an open list alone. */
  private shown = '';

  constructor(
    private readonly strings: PanelStrings,
    onChoose: (account: string) => void,
  ) {
    const select = this.element;
    select.className = 'np-account';
    select.hidden = true;
    select.title = strings.account;
    select.setAttribute('aria-label', strings.account);
    select.addEventListener('change', () => onChoose(select.value));
  }

  render(data: TimelineData): void {
    const accounts = data.accounts ?? [];
    this.element.hidden = accounts.length < 2;
    if (this.element.hidden) {
      this.shown = '';
      this.element.replaceChildren();
      return;
    }
    const options = accounts.map((account) => {
      const label = accountLabel(account, accounts);
      return {
        key: account.key,
        text: account.current ? this.strings.accountSignedIn.replace('{0}', label) : label,
      };
    });
    const shown = JSON.stringify(options);
    if (shown !== this.shown) {
      this.shown = shown;
      this.element.replaceChildren(
        ...options.map(({ key, text }) => {
          const option = document.createElement('option');
          option.value = key;
          option.textContent = text;
          return option;
        }),
      );
    }
    if (data.account !== undefined && this.element.value !== data.account) {
      this.element.value = data.account;
    }
  }
}

/** The email, with the organization when another account has the same email, and the plan. */
export function accountLabel(account: AccountOption, all: readonly AccountOption[]): string {
  const email = account.email.toLowerCase();
  const shared = all.some((other) => other !== account && other.email.toLowerCase() === email);
  const parts = [account.email];
  if (shared && account.organization) parts.push(account.organization);
  if (account.plan) parts.push(account.plan.charAt(0).toUpperCase() + account.plan.slice(1));
  return parts.join(' · ');
}
