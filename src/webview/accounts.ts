import type { AccountOption, PanelStrings, TimelineData } from '../shared/protocol';

/** Chooses which account's usage the panel shows; there only while there is more than one. */
export class AccountChooser {
  readonly element = document.createElement('select');

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
      this.element.replaceChildren();
      return;
    }
    this.element.replaceChildren(
      ...accounts.map((account) => {
        const option = document.createElement('option');
        option.value = account.key;
        const label = accountLabel(account, accounts);
        option.textContent = account.current
          ? this.strings.accountSignedIn.replace('{0}', label)
          : label;
        option.selected = account.key === data.account;
        return option;
      }),
    );
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
