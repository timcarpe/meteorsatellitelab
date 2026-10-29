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

const NS = 'http://www.w3.org/2000/svg';
export type MapView = 'sunrise' | 'global';
const colors = ['#72e0e4', '#c2b6ff'];
const extent: [[number, number], [number, number]] = [
  [20, 14],
  [940, 388],
];
const projections = {
  global: geoNaturalEarth1().fitExtent(extent, { type: 'Sphere' }),
  sunrise: geoMercator()
    .center([SUNRISE.longitude, SUNRISE.latitude])
    .scale(1150)
    .translate([480, 200])
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

function withinMap(point: [number, number] | null): point is [number, number] {
  return (
    point !== null &&
    point[0] >= extent[0][0] &&
    point[0] <= extent[1][0] &&
    point[1] >= extent[0][1] &&
    point[1] <= extent[1][1]
  );
}

export class EarthMap {
  private view: MapView = 'sunrise';
  private readonly base = svgElement('g', {});
  private readonly dynamic = svgElement('g', {});
  private readonly svg = svgElement('svg', {
    viewBox: '0 0 960 400',
    role: 'img',
    'aria-label':
      'Earth map showing Meteor satellite positions and predicted ground tracks',
  });
  public constructor(container: HTMLElement) {
    this.svg.append(this.base, this.dynamic);
    this.setView('sunrise');
    container.replaceChildren(this.svg);
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
    const projection = projections[view];
    const path = geoPath(projection);
    const topology = countries as unknown as Topology<{
      countries: GeometryCollection;
    }>;
    const elements: SVGElement[] = [
      svgElement('path', {
        d: path({ type: 'Sphere' }) ?? '',
        fill: '#18343a',
        stroke: '#49695f',
        'stroke-width': '1',
      }),
      svgElement('path', {
        d: path(geoGraticule10()) ?? '',
        fill: 'none',
        stroke: '#2d4b45',
        'stroke-width': '.7',
      }),
      svgElement('path', {
        d: path(feature(topology, topology.objects.countries)) ?? '',
        fill: '#36594f',
        stroke: '#59786a',
        'stroke-width': '.8',
      }),
    ];
    if (view === 'sunrise') {
      for (const [name, longitude, latitude] of regionLabels) {
        const point = projection([longitude, latitude]);
        if (!withinMap(point) || point[1] < extent[0][1] + 18) continue;
        const label = svgElement('text', {
          x: `${point[0]}`,
          y: `${point[1]}`,
          fill: '#d4e2d7',
          'font-size': '20',
          'text-anchor': 'middle',
          stroke: '#36594f',
          'stroke-width': '3',
          'paint-order': 'stroke',
        });
        label.textContent = name;
        elements.push(label);
      }
    }
    this.base.replaceChildren(...elements);
  }

  public render(
    orbits: readonly Orbit[],
    observer: Observer,
    at: number,
    pass?: Pass,
  ): void {
    const mapProjection = projections[this.view];
    const path = geoPath(mapProjection);
    const school = mapProjection([observer.longitude, observer.latitude]);
    const elements: SVGElement[] = [];
    orbits.forEach((orbit, index) => {
      const color = colors[index % colors.length]!;
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
        elements.push(
          svgElement('path', {
            d: path({ type: 'LineString', coordinates }) ?? '',
            fill: 'none',
            stroke: color,
            'stroke-width': '2',
            opacity: pass && pass.norad !== orbit.norad ? '0.25' : '0.8',
            'stroke-dasharray': dashed ? '5 5' : 'none',
          }),
        );
      }
      const radius =
        ((Math.acos((6371 * Math.cos(Math.PI / 18)) / (6371 + position.altitudeKm)) -
          Math.PI / 18) *
          180) /
        Math.PI;
      const footprint = geoCircle()
        .center([position.longitude, position.latitude])
        .radius(radius)();
      elements.push(
        svgElement('path', {
          d: path(footprint) ?? '',
          fill: color,
          'fill-opacity': '0.07',
          stroke: color,
          'stroke-opacity': '0.4',
          'stroke-width': '1',
        }),
      );
      const point = mapProjection([position.longitude, position.latitude]);
      if (withinMap(point)) {
        elements.push(
          svgElement('circle', {
            cx: `${point[0]}`,
            cy: `${point[1]}`,
            r: '10',
            fill: color,
            'fill-opacity': '0.15',
          }),
        );
        elements.push(
          svgElement('path', {
            d: 'M-7,-4h4v8h-4zM3,-4h4v8h-4zM-2,-3h4v6h-4z',
            fill: color,
            transform: `translate(${point[0]},${point[1]}) rotate(-25)`,
          }),
        );
        const leftLabel =
          school !== null &&
          point[0] < school[0] &&
          Math.abs(point[0] - school[0]) < 160 &&
          Math.abs(point[1] - school[1]) < 60;
        const label = svgElement('text', {
          x: `${leftLabel ? Math.max(150, point[0] - 16) : Math.min(800, point[0] + 16)}`,
          y: `${Math.max(32, point[1] - 12)}`,
          'text-anchor': leftLabel ? 'end' : 'start',
          fill: color,
          'font-size': '20',
          'font-weight': '600',
          stroke: '#18343a',
          'stroke-width': '3',
          'paint-order': 'stroke',
        });
        label.textContent = orbit.name;
        elements.push(label);
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
        elements.push(
          svgElement('path', {
            d: path({ type: 'LineString', coordinates }) ?? '',
            fill: 'none',
            stroke: '#e2dcff',
            'stroke-width': '4',
          }),
        );
      }
    }
    if (withinMap(school)) {
      elements.push(
        svgElement('circle', {
          cx: `${school[0]}`,
          cy: `${school[1]}`,
          r: '16',
          fill: '#ffcf70',
          'fill-opacity': '.12',
        }),
      );
      elements.push(
        svgElement('circle', {
          cx: `${school[0]}`,
          cy: `${school[1]}`,
          r: '7',
          fill: '#ffcf70',
          stroke: '#18343a',
          'stroke-width': '3',
        }),
      );
      const label = svgElement('text', {
        x: `${school[0] + 16}`,
        y: `${school[1] + 23}`,
        fill: '#ffda8a',
        'font-size': '20',
        'font-weight': '700',
        stroke: '#18343a',
        'stroke-width': '5',
        'paint-order': 'stroke',
      });
      label.textContent = observer.name;
      elements.push(label);
    }
    this.dynamic.replaceChildren(...elements);
  }
}
