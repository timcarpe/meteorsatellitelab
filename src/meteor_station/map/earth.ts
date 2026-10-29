/** Earth map and ground tracks generated from propagated positions, not illustrations. */
import {
  geoNaturalEarth1,
  geoMercator,
  geoPath,
  geoGraticule10,
  geoCircle,
} from 'd3-geo';
import { feature } from 'topojson-client';
import countries from 'world-atlas/countries-110m.json';
import type { Topology, GeometryCollection } from 'topojson-specification';
import { SUNRISE, type Observer, type Pass } from '@meteor/core/models';
import { positionAt, type Orbit } from '@meteor/orbit/propagation';
import {
  MAP_SIZE,
  mapFrame,
  overlapArea,
  placeLabel,
  textBox,
  unitsPerPixel,
  type Box,
  type MapView,
} from '@meteor/map/layout';

export type { MapView } from '@meteor/map/layout';
const NS = 'http://www.w3.org/2000/svg';
/** Colors come from CSS tokens (`.sat-1`, `.sat-2`) so the map, legend and UI agree. */
const SATELLITE_CLASSES = ['sat-1', 'sat-2'];
/** On-screen text sizes in CSS pixels, independent of the rendered map width. */
const TEXT = { region: 12, satellite: 13, campus: 14 } as const;
const extent: [[number, number], [number, number]] = [
  [20, 14],
  [940, 388],
];
const projections = {
  global: geoNaturalEarth1().fitExtent(extent, { type: 'Sphere' }),
  sunrise: geoMercator()
    .center([SUNRISE.longitude, SUNRISE.latitude])
    .scale(1150)
    .translate([MAP_SIZE.width / 2, 200])
    .clipExtent(extent),
};
const regionLabels: readonly [string, number, number][] = [
  ['Vietnam', 108.3, 16.8],
  ['Thailand', 100.5, 16.2],
  ['Cambodia', 104.6, 13.1],
  ['Laos', 102.8, 19.8],
  ['Malaysia', 102.0, 4.3],
  ['Philippines', 122.3, 12.8],
];

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}

export class EarthMap {
  private view: MapView = 'sunrise';
  private frame: Box = { x: 0, y: 0, ...MAP_SIZE };
  private unit = 1;
  private last: Parameters<EarthMap['render']> | null = null;
  private readonly base = svgElement('g', {});
  private readonly regions = svgElement('g', { 'aria-hidden': 'true' });
  private readonly dynamic = svgElement('g', {});
  private readonly svg = svgElement('svg', {
    viewBox: `0 0 ${MAP_SIZE.width} ${MAP_SIZE.height}`,
    role: 'img',
    class: 'earth-svg',
    'aria-label':
      'Earth map showing Meteor satellite positions and predicted ground tracks',
  });
  public constructor(private readonly container: HTMLElement) {
    this.svg.append(this.base, this.regions, this.dynamic);
    container.replaceChildren(this.svg);
    this.setView('sunrise');
    // Re-frame when the panel width changes so text stays a constant on-screen size.
    new ResizeObserver(() => this.layout()).observe(container);
  }

  /** Change geographic framing without changing the selected pass or preview time. */
  public setView(view: MapView): void {
    this.view = view;
    this.svg.setAttribute(
      'aria-label',
      view === 'sunrise'
        ? 'Regional map centred on VAS Sunrise in Ho Chi Minh City with Meteor ground tracks'
        : 'Global Earth map showing Meteor satellite positions and ground tracks',
    );
    const path = geoPath(projections[view]);
    const topology = countries as unknown as Topology<{
      countries: GeometryCollection;
    }>;
    this.base.replaceChildren(
      svgElement('path', { d: path({ type: 'Sphere' }) ?? '', class: 'map-sphere' }),
      svgElement('path', { d: path(geoGraticule10()) ?? '', class: 'map-graticule' }),
      svgElement('path', {
        d: path(feature(topology, topology.objects.countries)) ?? '',
        class: 'map-land',
      }),
    );
    this.layout();
  }

  public render(
    orbits: readonly Orbit[],
    observer: Observer,
    at: number,
    pass?: Pass,
  ): void {
    this.last = [orbits, observer, at, pass];
    const mapProjection = projections[this.view];
    const path = geoPath(mapProjection);
    const visible = this.visibleBounds();
    const within = (point: [number, number] | null): point is [number, number] =>
      point !== null &&
      point[0] >= visible.x &&
      point[0] <= visible.x + visible.width &&
      point[1] >= visible.y &&
      point[1] <= visible.y + visible.height;
    const school = mapProjection([observer.longitude, observer.latitude]);
    const tracks: SVGElement[] = [];
    const markers: SVGElement[] = [];
    const labels: SVGElement[] = [];
    const occupied: Box[] = [];
    const u = this.unit;
    const markerBox = ([x, y]: [number, number], r: number): Box => ({
      x: x - r,
      y: y - r,
      width: 2 * r,
      height: 2 * r,
    });
    const label = (
      text: string,
      anchor: [number, number],
      size: number,
      className: string,
    ): void => {
      const fontSize = size * u;
      const placement = placeLabel(
        anchor,
        textBox(text, fontSize),
        12 * u,
        occupied,
        visible,
      );
      occupied.push(placement.box);
      const element = svgElement('text', {
        x: `${placement.x}`,
        y: `${placement.y}`,
        'text-anchor': placement.textAnchor,
        'font-size': `${fontSize}`,
        'stroke-width': `${3.5 * u}`,
        class: `map-label ${className}`,
      });
      element.textContent = text;
      labels.push(element);
    };

    if (within(school)) occupied.push(markerBox(school, 9 * u));
    orbits.forEach((orbit, index) => {
      const satellite = SATELLITE_CLASSES[index % SATELLITE_CLASSES.length]!;
      const dimmed = pass !== undefined && pass.norad !== orbit.norad;
      const group = svgElement('g', {
        class: `${satellite}${dimmed ? ' map-dimmed' : ''}`,
      });
      const position = positionAt(orbit, at, observer);
      const before: [number, number][] = [],
        after: [number, number][] = [];
      for (let minutes = -35; minutes <= 95; minutes++) {
        const p = positionAt(orbit, at + minutes * 60000, observer);
        (minutes <= 0 ? before : after).push([p.longitude, p.latitude]);
      }
      for (const [coordinates, dashed] of [
        [before, false],
        [after, true],
      ] as const) {
        group.append(
          svgElement('path', {
            d: path({ type: 'LineString', coordinates }) ?? '',
            class: dashed ? 'map-track map-track-next' : 'map-track',
          }),
        );
      }
      // Visibility footprint above 10° elevation for the current altitude.
      const radius =
        ((Math.acos((6371 * Math.cos(Math.PI / 18)) / (6371 + position.altitudeKm)) -
          Math.PI / 18) *
          180) /
        Math.PI;
      const footprint = geoCircle()
        .center([position.longitude, position.latitude])
        .radius(radius)();
      group.append(
        svgElement('path', { d: path(footprint) ?? '', class: 'map-footprint' }),
      );
      tracks.push(group);
      const point = mapProjection([position.longitude, position.latitude]);
      if (within(point)) {
        const marker = svgElement('g', {
          class: satellite,
          transform: `translate(${point[0]},${point[1]}) scale(${u})`,
        });
        marker.append(
          svgElement('circle', { r: '9', class: 'map-sat-halo' }),
          svgElement('path', {
            d: 'M-7,-4h4v8h-4zM3,-4h4v8h-4zM-2,-3h4v6h-4z',
            class: 'map-sat',
            transform: 'rotate(-25)',
          }),
        );
        markers.push(marker);
        occupied.push(markerBox(point, 9 * u));
      }
    });
    if (pass) {
      const orbit = orbits.find((item) => item.norad === pass.norad);
      if (orbit) {
        const coordinates: [number, number][] = [];
        for (let t = pass.start; t <= pass.end; t += 15000) {
          const p = positionAt(orbit, t, observer);
          coordinates.push([p.longitude, p.latitude]);
        }
        tracks.push(
          svgElement('path', {
            d: path({ type: 'LineString', coordinates }) ?? '',
            class: 'map-pass',
          }),
        );
      }
    }
    if (within(school)) {
      const marker = svgElement('g', {
        transform: `translate(${school[0]},${school[1]}) scale(${u})`,
      });
      marker.append(
        svgElement('circle', { r: '15', class: 'map-campus-halo' }),
        svgElement('circle', { r: '6', class: 'map-campus' }),
      );
      markers.push(marker);
      // The campus is the primary reference, so it claims its label position first.
      label(observer.name, school, TEXT.campus, 'map-campus-label');
    }
    orbits.forEach((orbit, index) => {
      const position = positionAt(orbit, at, observer);
      const point = mapProjection([position.longitude, position.latitude]);
      if (within(point))
        label(
          orbit.name,
          point,
          TEXT.satellite,
          `map-sat-label ${SATELLITE_CLASSES[index % SATELLITE_CLASSES.length]}`,
        );
    });
    this.dynamic.replaceChildren(...tracks, ...markers, ...labels);
    this.renderRegions(occupied);
  }

  /** Context labels yield to the campus and satellites rather than overlapping them. */
  private renderRegions(occupied: readonly Box[]): void {
    const elements: SVGElement[] = [];
    if (this.view === 'sunrise') {
      const visible = this.visibleBounds();
      const fontSize = TEXT.region * this.unit;
      for (const [name, longitude, latitude] of regionLabels) {
        const point = projections.sunrise([longitude, latitude]);
        if (!point) continue;
        const size = textBox(name, fontSize);
        const box = {
          x: point[0] - size.width / 2,
          y: point[1] - size.height * 0.8,
          ...size,
        };
        const fits =
          box.x >= visible.x &&
          box.y >= visible.y &&
          box.x + box.width <= visible.x + visible.width &&
          box.y + box.height <= visible.y + visible.height;
        if (!fits || occupied.some((other) => overlapArea(box, other) > 0)) continue;
        const label = svgElement('text', {
          x: `${point[0]}`,
          y: `${point[1]}`,
          'font-size': `${fontSize}`,
          'stroke-width': `${3 * this.unit}`,
          'text-anchor': 'middle',
          class: 'map-label map-region',
        });
        label.textContent = name;
        elements.push(label);
      }
    }
    this.regions.replaceChildren(...elements);
  }

  private visibleBounds(): Box {
    const left = Math.max(this.frame.x, extent[0][0]);
    const top = Math.max(this.frame.y, extent[0][1]);
    return {
      x: left,
      y: top,
      width: Math.min(this.frame.x + this.frame.width, extent[1][0]) - left,
      height: Math.min(this.frame.y + this.frame.height, extent[1][1]) - top,
    };
  }

  private layout(): void {
    const width = this.container.clientWidth;
    this.frame = mapFrame(this.view, width);
    this.unit = unitsPerPixel(this.frame, width);
    const { x, y, width: w, height: h } = this.frame;
    this.svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    if (this.last) this.render(...this.last);
    else this.renderRegions([]);
  }
}
