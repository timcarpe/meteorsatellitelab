/** Shared canvas helpers: crisp sizing in CSS pixels and colors from CSS tokens. */
export const INSTRUMENT_TOKENS = [
  '--night',
  '--night-raised',
  '--night-line',
  '--night-ink',
  '--night-muted',
  '--signal',
] as const;
export type InstrumentPalette = Record<(typeof INSTRUMENT_TOKENS)[number], string>;
export const NUMERIC_FONT = 'ui-monospace, "SF Mono", Consolas, monospace';
export const TEXT_FONT = '"DM Sans Variable", Arial, sans-serif';

/** Read instrument colors from the stylesheet so canvases follow the design tokens. */
export function instrumentPalette(element: Element): InstrumentPalette {
  const style = getComputedStyle(element);
  return Object.fromEntries(
    INSTRUMENT_TOKENS.map((name) => [
      name,
      style.getPropertyValue(name).trim() || '#000',
    ]),
  ) as InstrumentPalette;
}

/**
 * Match the backing store to the displayed size and device pixel ratio. Returns the
 * drawing size in CSS pixels, or null while the canvas is hidden.
 */
export function fitCanvas(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
): { width: number; height: number } | null {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return null;
  const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width, height };
}
