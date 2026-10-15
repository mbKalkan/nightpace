// What Claude Code's requests would have cost at API list prices: today, the last 7 and 30 days,
// and an average working day. Fixed periods, so they don't move with the range or the zoom.
import type { PanelStrings, Spend } from '../shared/protocol';
import type { Formats } from './format';

export class SpendTiles {
  readonly element = document.createElement('section');
  private readonly tiles = document.createElement('dl');
  private readonly note = document.createElement('p');

  constructor(
    private readonly strings: PanelStrings,
    private readonly formats: Formats,
  ) {
    this.element.className = 'np-spend';
    this.element.setAttribute('aria-labelledby', 'np-spend-title');
    this.element.hidden = true;
    const title = document.createElement('h2');
    title.id = 'np-spend-title';
    title.className = 'np-spend-title';
    title.textContent = strings.spendTitle;
    this.tiles.className = 'np-spend-tiles';
    this.note.className = 'np-note-text';
    this.element.append(title, this.tiles, this.note);
  }

  render(spend: Spend): void {
    const s = this.strings;
    const tiles: Array<[string, number]> = [
      [s.spendToday, spend.today],
      [s.spendLast7Days, spend.last7Days],
      [s.spendLast30Days, spend.last30Days],
      [s.spendPerActiveDay, spend.perActiveDay],
    ];
    this.tiles.replaceChildren(
      ...tiles.map(([label, value]) => {
        const tile = document.createElement('div');
        tile.className = 'np-spend-tile';
        const term = document.createElement('dt');
        term.textContent = label;
        const amount = document.createElement('dd');
        amount.textContent = this.formats.money(value);
        tile.append(term, amount);
        return tile;
      }),
    );
    this.note.hidden = spend.unpriced === 0;
    this.note.textContent = s.spendUnpriced.replace('{0}', String(spend.unpriced));
    this.element.hidden = false;
  }
}
