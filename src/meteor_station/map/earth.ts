/** Earth map and ground tracks generated from propagated positions, not illustrations. */
import { geoNaturalEarth1, geoPath, geoGraticule10, geoCircle } from 'd3-geo';
import { feature } from 'topojson-client';
import countries from 'world-atlas/countries-110m.json';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Observer, Pass } from '@meteor/core/models';
import { positionAt, type Orbit } from '@meteor/orbit/propagation';

const NS = 'http://www.w3.org/2000/svg';
const colors = ['#78e1d0', '#ffbe7d'];
const mapProjection = geoNaturalEarth1().fitExtent(
  [
    [20, 14],
    [940, 468],
  ],
  { type: 'Sphere' },
);
const path = geoPath(mapProjection);

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}

export class EarthMap {
  private readonly dynamic = svgElement('g', {});
  private readonly svg = svgElement('svg', {
    viewBox: '0 0 960 480',
    role: 'img',
    'aria-label':
      'Earth map showing Meteor satellite positions and predicted ground tracks',
  });
  public constructor(container: HTMLElement) {
    const topology = countries as unknown as Topology<{
      countries: GeometryCollection;
    }>;
    this.svg.append(
      svgElement('path', {
        d: path({ type: 'Sphere' }) ?? '',
        fill: '#163e46',
        stroke: '#31545b',
        'stroke-width': '1',
      }),
    );
    this.svg.append(
      svgElement('path', {
        d: path(geoGraticule10()) ?? '',
        fill: 'none',
        stroke: '#31545b',
        'stroke-width': '0.55',
        opacity: '0.65',
      }),
    );
    this.svg.append(
      svgElement('path', {
        d: path(feature(topology, topology.objects.countries)) ?? '',
        fill: '#42676a',
        stroke: '#244b52',
        'stroke-width': '0.5',
      }),
    );
    this.svg.append(this.dynamic);
    container.replaceChildren(this.svg);
  }

  public render(
    orbits: readonly Orbit[],
    observer: Observer,
    at: number,
    pass?: Pass,
  ): void {
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
            'stroke-width': '1.6',
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
      if (point) {
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
        const label = svgElement('text', {
          x: `${Math.min(840, point[0] + 14)}`,
          y: `${point[1] - 9}`,
          fill: color,
          'font-size': '12',
          'font-weight': '600',
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
            stroke: '#fff5d9',
            'stroke-width': '3',
          }),
        );
      }
    }
    const school = mapProjection([observer.longitude, observer.latitude]);
    if (school) {
      elements.push(
        svgElement('circle', {
          cx: `${school[0]}`,
          cy: `${school[1]}`,
          r: '5',
          fill: '#fff5d9',
          stroke: '#173c43',
          'stroke-width': '2',
        }),
      );
      const label = svgElement('text', {
        x: `${school[0] + 10}`,
        y: `${school[1] + 18}`,
        fill: '#fff5d9',
        'font-size': '12',
        'font-weight': '600',
      });
      label.textContent = observer.name;
      elements.push(label);
    }
    this.dynamic.replaceChildren(...elements);
  }
}
