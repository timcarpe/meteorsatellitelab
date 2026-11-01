/** High-contrast spectrum and measured IQ waterfall. No simulated radio data. */
import {
  fitCanvas,
  instrumentPalette,
  NUMERIC_FONT,
  TEXT_FONT,
  type InstrumentPalette,
} from '@meteor/ui/canvas';
import { summarizeSpectrum, type SpectrumReadout } from '@meteor/radio/spectrum-metrics';

const HISTORY_ROWS = 128;
const HISTORY_BINS = 512;
const MIN_DB = -100;
const MAX_DB = -20;

// Deliberately perceptual, with darkest values used for the noise floor.
function heatColor(db: number): [number, number, number] {
  const value = Math.min(1, Math.max(0, (db + 96) / 70));
  const stops: readonly [number, number, number, number][] = [
    [0, 11, 27, 44],
    [0.23, 23, 61, 83],
    [0.48, 28, 116, 135],
    [0.74, 85, 211, 195],
    [1, 246, 233, 163],
  ];
  for (let i = 1; i < stops.length; i++) {
    const high = stops[i]!;
    if (value <= high[0]) {
      const low = stops[i - 1]!;
      const fraction = (value - low[0]) / (high[0] - low[0]);
      return [1, 2, 3].map((j) => Math.round(low[j]! + (high[j]! - low[j]!) * fraction)) as [number, number, number];
    }
  }
  return [246, 233, 163];
}

export class SpectrumView {
  private readonly context: CanvasRenderingContext2D;
  private readonly history = document.createElement('canvas');
  private readonly historyContext: CanvasRenderingContext2D;
  private readonly palette: InstrumentPalette;
  private frequency = 137900000;
  private sampleRate = 288000;
  private bins: Float32Array | null = null;
  private emptyMessage = 'Start reception to see live radio samples';
  private historyCount = 0;

  public constructor(private readonly canvas: HTMLCanvasElement) {
    this.context = canvas.getContext('2d')!;
    this.palette = instrumentPalette(canvas);
    this.history.width = HISTORY_BINS;
    this.history.height = HISTORY_ROWS;
    this.historyContext = this.history.getContext('2d')!;
    new ResizeObserver(() => this.draw()).observe(canvas);
    this.reset(this.emptyMessage);
  }

  public configure(frequency: number, sampleRate: number): void {
    this.frequency = frequency;
    this.sampleRate = sampleRate;
    this.draw();
  }

  public reset(message: string): void {
    this.bins = null;
    this.emptyMessage = message;
    this.historyCount = 0;
    this.historyContext.clearRect(0, 0, HISTORY_BINS, HISTORY_ROWS);
    this.draw();
  }

  public update(bins: Float32Array): SpectrumReadout | null {
    if (bins.length !== HISTORY_BINS) return null;
    this.bins = bins;
    const ctx = this.historyContext;
    ctx.drawImage(this.history, 0, 0, HISTORY_BINS, HISTORY_ROWS - 1, 0, 1, HISTORY_BINS, HISTORY_ROWS - 1);
    const row = ctx.createImageData(HISTORY_BINS, 1);
    for (let i = 0; i < HISTORY_BINS; i++) {
      const [red, green, blue] = heatColor(bins[i]!);
      const at = i * 4;
      row.data[at] = red;
      row.data[at + 1] = green;
      row.data[at + 2] = blue;
      row.data[at + 3] = 255;
    }
    ctx.putImageData(row, 0, 0);
    this.historyCount = Math.min(HISTORY_ROWS, this.historyCount + 1);
    this.draw();
    return summarizeSpectrum(bins, this.frequency, this.sampleRate);
  }

  private draw(): void {
    const ctx = this.context;
    const size = fitCanvas(this.canvas, ctx);
    if (!size) return;
    const { width, height } = size;
    const ink = this.palette;
    const compact = width < 450;
    const left = compact ? 43 : 56;
    const right = width - (compact ? 14 : 22);
    const plotWidth = Math.max(1, right - left);
    const top = 36;
    const traceBottom = Math.round(height * 0.475);
    const freqAxis = traceBottom + 21;
    const waterfallTitle = traceBottom + 44;
    const waterfallTop = traceBottom + 55;
    const waterfallBottom = height - 14;
    const traceHeight = traceBottom - top;
    const yFor = (db: number) =>
      top + Math.max(0, Math.min(1, (MAX_DB - db) / (MAX_DB - MIN_DB))) * traceHeight;

    ctx.fillStyle = ink['--night'];
    ctx.fillRect(0, 0, width, height);
    ctx.textBaseline = 'middle';
    ctx.font = `600 10px ${TEXT_FONT}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = ink['--night-muted'];
    ctx.fillText('POWER', left, 19);
    ctx.textAlign = 'right';
    ctx.fillText('dBFS', right, 19);

    ctx.lineWidth = 1;
    ctx.font = `11px ${NUMERIC_FONT}`;
    for (const db of [-20, -40, -60, -80, -100]) {
      const y = Math.round(yFor(db)) + 0.5;
      ctx.strokeStyle = ink['--night-line'];
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillStyle = ink['--night-muted'];
      ctx.fillText(`${db}`, left - 9, y);
    }
    const fractions = compact ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
    for (const fraction of fractions) {
      const x = Math.round(left + fraction * plotWidth) + 0.5;
      if (fraction > 0 && fraction < 1) {
        ctx.strokeStyle = ink['--night-line'];
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, traceBottom);
        ctx.stroke();
      }
      const offset = (fraction - 0.5) * this.sampleRate;
      const freqLabel = this.frequency > 0
        ? ((this.frequency + offset) / 1e6).toFixed(3)
        : `${offset >= 0 ? '+' : ''}${(offset / 1000).toFixed(0)} kHz`;
      ctx.textAlign = fraction === 0 ? 'left' : fraction === 1 ? 'right' : 'center';
      ctx.fillStyle = ink['--night-muted'];
      ctx.fillText(freqLabel, x, freqAxis);
    }

    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = 'rgba(164, 222, 215, 0.46)';
    ctx.beginPath();
    const center = left + plotWidth / 2;
    ctx.moveTo(center + 0.5, top);
    ctx.lineTo(center + 0.5, traceBottom);
    ctx.stroke();
    ctx.restore();

    if (this.bins) {
      const gradient = ctx.createLinearGradient(0, top, 0, traceBottom);
      gradient.addColorStop(0, 'rgba(88, 224, 200, 0.27)');
      gradient.addColorStop(1, 'rgba(88, 224, 200, 0.012)');
      ctx.beginPath();
      this.bins.forEach((db, index) => {
        const x = left + (index / (HISTORY_BINS - 1)) * plotWidth;
        const y = yFor(db);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.lineTo(right, traceBottom);
      ctx.lineTo(left, traceBottom);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.beginPath();
      this.bins.forEach((db, index) => {
        const x = left + (index / (HISTORY_BINS - 1)) * plotWidth;
        const y = yFor(db);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = ink['--signal'];
      ctx.lineWidth = 1.7;
      ctx.lineJoin = 'round';
      ctx.stroke();
    } else {
      ctx.font = `13px ${TEXT_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = ink['--night-ink'];
      const message = compact && this.emptyMessage.length > 38 ? 'Waiting for radio samples' : this.emptyMessage;
      ctx.fillText(message, (left + right) / 2, top + traceHeight / 2);
    }

    ctx.font = `600 10px ${TEXT_FONT}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = ink['--night-muted'];
    ctx.fillText('WATERFALL', left, waterfallTitle);
    ctx.textAlign = 'right';
    ctx.fillText('NEWEST AT TOP', right, waterfallTitle);
    ctx.fillStyle = ink['--night-raised'];
    const fallHeight = Math.max(12, waterfallBottom - waterfallTop);
    ctx.fillRect(left, waterfallTop, plotWidth, fallHeight);
    if (this.historyCount) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, waterfallTop, plotWidth, fallHeight);
      ctx.clip();
      ctx.imageSmoothingEnabled = false;
      // Do not stretch the history of just a few samples into a full-depth waterfall.
      const rowHeight = fallHeight / HISTORY_ROWS;
      ctx.drawImage(this.history, 0, 0, HISTORY_BINS, this.historyCount,
        left, waterfallTop, plotWidth, this.historyCount * rowHeight);
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(164, 222, 215, 0.19)';
    ctx.beginPath();
    ctx.moveTo(left + plotWidth / 2 + 0.5, waterfallTop);
    ctx.lineTo(left + plotWidth / 2 + 0.5, waterfallBottom);
    ctx.stroke();
  }
}
