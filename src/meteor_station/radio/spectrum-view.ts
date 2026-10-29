/** Canvas instrumentation for measured IQ power and a bounded recent-history waterfall. */
import {
  fitCanvas,
  instrumentPalette,
  NUMERIC_FONT,
  TEXT_FONT,
  type InstrumentPalette,
} from '@meteor/ui/canvas';

export class SpectrumView {
  private readonly context: CanvasRenderingContext2D;
  private readonly history = document.createElement('canvas');
  private readonly historyContext: CanvasRenderingContext2D;
  private readonly palette: InstrumentPalette;
  private frequency = 137900000;
  private sampleRate = 288000;
  private bins: Float32Array | null = null;
  private emptyMessage = 'Start reception to view the signal';

  public constructor(private readonly canvas: HTMLCanvasElement) {
    this.context = canvas.getContext('2d')!;
    this.palette = instrumentPalette(canvas);
    this.history.width = 512;
    this.history.height = 100;
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
    this.historyContext.clearRect(0, 0, this.history.width, this.history.height);
    this.draw();
  }

  public update(bins: Float32Array): void {
    this.bins = bins;
    const ctx = this.historyContext;
    ctx.drawImage(this.history, 0, 0, 512, 99, 0, 1, 512, 99);
    const row = ctx.createImageData(512, 1);
    for (let i = 0; i < 512; i++) {
      const value = Math.max(0, Math.min(1, (bins[i]! + 90) / 80));
      row.data.set(
        [
          Math.round(12 + 220 * value ** 3),
          Math.round(28 + 210 * value),
          Math.round(48 + 150 * Math.sin((value * Math.PI) / 2)),
          255,
        ],
        i * 4,
      );
    }
    ctx.putImageData(row, 0, 0);
    this.draw();
  }

  private draw(): void {
    const ctx = this.context;
    const size = fitCanvas(this.canvas, ctx);
    if (!size) return;
    const { width, height } = size;
    const colors = this.palette;
    const left = 44,
      right = width - 16,
      top = 14,
      bottom = Math.round(height * 0.52),
      axis = bottom + 20,
      fallTop = axis + 12,
      fallBottom = height - 12;
    ctx.fillStyle = colors['--night'];
    ctx.fillRect(0, 0, width, height);
    ctx.font = `12px ${NUMERIC_FONT}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    for (const db of [0, -30, -60, -90]) {
      const y = Math.round(top + (-db / 90) * (bottom - top)) + 0.5;
      ctx.strokeStyle = colors['--night-line'];
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.fillStyle = colors['--night-muted'];
      ctx.fillText(`${db}`, left - 8, y);
    }
    ctx.fillStyle = colors['--night-raised'];
    ctx.fillRect(left, fallTop, right - left, fallBottom - fallTop);
    if (this.bins) {
      ctx.strokeStyle = colors['--signal'];
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      this.bins.forEach((value, i) => {
        const x = left + (i / (this.bins!.length - 1)) * (right - left);
        const y = top + Math.max(0, Math.min(1, -value / 90)) * (bottom - top);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.history, left, fallTop, right - left, fallBottom - fallTop);
    } else {
      ctx.fillStyle = colors['--night-ink'];
      ctx.font = `15px ${TEXT_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(this.emptyMessage, (left + right) / 2, (top + bottom) / 2);
    }
    ctx.font = `12px ${NUMERIC_FONT}`;
    ctx.fillStyle = colors['--night-muted'];
    const ticks = right - left < 360 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
    for (const fraction of ticks) {
      const offset = (fraction - 0.5) * this.sampleRate;
      const label =
        this.frequency > 0
          ? `${((this.frequency + offset) / 1e6).toFixed(3)}`
          : `${offset >= 0 ? '+' : ''}${(offset / 1000).toFixed(0)} kHz`;
      ctx.textAlign = fraction === 0 ? 'left' : fraction === 1 ? 'right' : 'center';
      ctx.fillText(label, left + fraction * (right - left), axis);
    }
  }
}
