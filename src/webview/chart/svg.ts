const NS = 'http://www.w3.org/2000/svg';

/** Creates an SVG element with attributes; text goes in with `textContent`, never as markup. */
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number> = {},
  text?: string,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}

/** A column with a 4px rounded top and a square base, as a path. */
export function columnPath(
  x: number,
  y: number,
  width: number,
  height: number,
  round: boolean,
): string {
  const r = round ? Math.min(4, width / 2, height) : 0;
  return [
    `M${x},${y + height}`,
    `V${y + r}`,
    r ? `Q${x},${y} ${x + r},${y}` : '',
    `H${x + width - r}`,
    r ? `Q${x + width},${y} ${x + width},${y + r}` : '',
    `V${y + height}`,
    'Z',
  ].join('');
}
