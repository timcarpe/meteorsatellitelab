/** Polar sky plot: horizon at the edge, overhead at the centre, north up, east right. */
import type { SkyPoint } from '@meteor/orbit/tracking';

const NS = 'http://www.w3.org/2000/svg';
const SIZE = 240;
const CENTRE = SIZE / 2;
const RADIUS = 100;

/** Plot coordinates for an azimuth/elevation pair; elevation below 0 clamps to the edge. */
export function skyXY(
  azimuth: number,
  elevation: number,
  radius = RADIUS,
): [number, number] {
  const r = (radius * (90 - Math.max(0, Math.min(90, elevation)))) / 90;
  const angle = (azimuth * Math.PI) / 180;
  return [r * Math.sin(angle), -r * Math.cos(angle)];
}

function svg<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}
const at = (point: [number, number]): [number, number] => [
  CENTRE + point[0],
  CENTRE + point[1],
];
const pathOf = (points: readonly SkyPoint[]): string =>
  points
    .map((point, index) => {
      const [x, y] = at(skyXY(point.azimuth, point.elevation));
      return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join('');

export class SkyPlot {
  private readonly root = svg('svg', {
    viewBox: `0 0 ${SIZE} ${SIZE}`,
    class: 'sky-svg',
    role: 'img',
    'aria-label':
      'Sky plot of the selected pass: horizon at the edge, overhead at the centre',
  });
  private readonly future = svg('path', { class: 'sky-track' });
  private readonly past = svg('path', { class: 'sky-track-past' });
  private readonly marks = svg('g', {});
  private readonly now = svg('g', { class: 'sky-now' });
  private track: readonly SkyPoint[] = [];

  public constructor(container: HTMLElement) {
    const grid = svg('g', { class: 'sky-grid' });
    for (const elevation of [0, 30, 60])
      grid.append(
        svg('circle', {
          cx: `${CENTRE}`,
          cy: `${CENTRE}`,
          r: `${(RADIUS * (90 - elevation)) / 90}`,
          class: elevation ? 'sky-ring' : 'sky-horizon',
        }),
      );
    grid.append(
      svg('path', {
        d: `M${CENTRE - RADIUS},${CENTRE}H${CENTRE + RADIUS}M${CENTRE},${CENTRE - RADIUS}V${CENTRE + RADIUS}`,
        class: 'sky-ring',
      }),
    );
    for (const [label, azimuth] of [
      ['N', 0],
      ['E', 90],
      ['S', 180],
      ['W', 270],
    ] as const) {
      const [x, y] = at(skyXY(azimuth, -1, RADIUS + 11));
      const text = svg('text', {
        x: `${x}`,
        y: `${y}`,
        class: 'sky-label',
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
      });
      text.textContent = label;
      grid.append(text);
    }
    for (const elevation of [30, 60]) {
      const [x, y] = at(skyXY(45, elevation));
      const text = svg('text', {
        x: `${x + 2}`,
        y: `${y - 2}`,
        class: 'sky-ring-label',
      });
      text.textContent = `${elevation}°`;
      grid.append(text);
    }
    this.now.append(
      svg('circle', { r: '11', class: 'sky-now-halo' }),
      svg('circle', { r: '5.5', class: 'sky-now-dot' }),
    );
    this.root.append(grid, this.future, this.past, this.marks, this.now);
    container.replaceChildren(this.root);
    this.setTrack([], null);
  }

  /** Draw a pass: rise and set markers, and the peak elevation label. */
  public setTrack(track: readonly SkyPoint[], peak: SkyPoint | null): void {
    this.track = track;
    this.future.setAttribute('d', pathOf(track));
    this.past.setAttribute('d', '');
    this.marks.replaceChildren();
    const first = track[0];
    const last = track.at(-1);
    if (first && last) {
      const [rx, ry] = at(skyXY(first.azimuth, first.elevation));
      const [sx, sy] = at(skyXY(last.azimuth, last.elevation));
      this.marks.append(
        svg('circle', { cx: `${rx}`, cy: `${ry}`, r: '3.5', class: 'sky-rise' }),
        svg('path', {
          d: `M${sx - 3.5},${sy - 3.5}l7,7m0,-7l-7,7`,
          class: 'sky-set',
        }),
      );
    }
    if (peak) {
      const [px, py] = at(skyXY(peak.azimuth, peak.elevation));
      const label = svg('text', { x: `${px + 8}`, y: `${py - 8}`, class: 'sky-peak' });
      label.textContent = `${Math.round(peak.elevation)}°`;
      this.marks.append(label);
    }
  }

  /** Move the live marker; elapsed track turns solid. Pass null to hide the marker. */
  public setPosition(position: SkyPoint | null): void {
    if (!position || position.elevation < 0) {
      this.now.setAttribute('visibility', 'hidden');
      const done =
        this.track.length && position && position.time > this.track.at(-1)!.time;
      this.past.setAttribute('d', done ? pathOf(this.track) : '');
      return;
    }
    const [x, y] = at(skyXY(position.azimuth, position.elevation));
    this.now.setAttribute('visibility', 'visible');
    this.now.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)})`);
    this.past.setAttribute(
      'd',
      pathOf([...this.track.filter((point) => point.time < position.time), position]),
    );
  }
}
