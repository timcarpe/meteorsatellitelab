/** Map framing and label placement in SVG user units, kept free of DOM access. */
export type MapView = 'sunrise' | 'global';

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly textAnchor: 'start' | 'end';
  readonly box: Box;
}

export const MAP_SIZE = { width: 960, height: 400 } as const;
const SIDES = ['se', 'ne', 'sw', 'nw'] as const;
type Side = (typeof SIDES)[number];

/**
 * The visible part of the map. The regional view is cropped around the campus on
 * narrow screens so the coastline and labels stay legible instead of shrinking.
 */
export function mapFrame(view: MapView, containerWidth: number): Box {
  if (view === 'global' || containerWidth <= 0) return { x: 0, y: 0, ...MAP_SIZE };
  const width = containerWidth < 560 ? 480 : containerWidth < 820 ? 720 : 960;
  return { x: (MAP_SIZE.width - width) / 2, y: 0, width, height: MAP_SIZE.height };
}

/** SVG user units per CSS pixel, used to keep text at a fixed on-screen size. */
export function unitsPerPixel(frame: Box, containerWidth: number): number {
  return containerWidth > 0 ? frame.width / containerWidth : 1;
}

/** Approximate rendered text extent for DM Sans; generous to avoid near-touching labels. */
export function textBox(
  text: string,
  fontSize: number,
): { width: number; height: number } {
  return { width: text.length * fontSize * 0.58, height: fontSize * 1.15 };
}

export function overlapArea(a: Box, b: Box): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function candidate(
  [ax, ay]: readonly [number, number],
  size: { width: number; height: number },
  gap: number,
  side: Side,
  bounds: Box,
): Placement & { shift: number } {
  const east = side.endsWith('e');
  const south = side.startsWith('s');
  const idealX = east ? ax + gap : ax - gap - size.width;
  const idealY = south ? ay + gap * 0.5 : ay - gap * 0.5 - size.height;
  // Clamp into the visible frame, recording how far the label had to move.
  const x = Math.min(
    Math.max(idealX, bounds.x + 2),
    bounds.x + bounds.width - size.width - 2,
  );
  const y = Math.min(
    Math.max(idealY, bounds.y + 2),
    bounds.y + bounds.height - size.height - 2,
  );
  return {
    x: east ? x : x + size.width,
    y: y + size.height * 0.8,
    textAnchor: east ? 'start' : 'end',
    box: { x, y, ...size },
    shift: Math.abs(x - idealX) + Math.abs(y - idealY),
  };
}

/**
 * Place a label beside its anchor, preferring the first side that fits the frame
 * without covering existing labels or markers. Otherwise use the side with the
 * least overlap, where a label shifted back over its own anchor counts as overlap.
 */
export function placeLabel(
  anchor: readonly [number, number],
  size: { width: number; height: number },
  gap: number,
  occupied: readonly Box[],
  bounds: Box,
): Placement {
  let best: Placement | null = null;
  let bestCost = Infinity;
  for (const side of SIDES) {
    const { shift, ...option } = candidate(anchor, size, gap, side, bounds);
    const overlap = occupied.reduce(
      (sum, box) => sum + overlapArea(option.box, box),
      0,
    );
    if (overlap === 0 && shift === 0) return option;
    const cost = overlap + shift * size.height;
    if (cost < bestCost) {
      best = option;
      bestCost = cost;
    }
  }
  return best!;
}
