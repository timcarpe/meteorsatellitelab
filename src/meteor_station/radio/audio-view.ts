/** A received-audio waveform; no animated or synthesized placeholder data. */
import {
  fitCanvas,
  instrumentPalette,
  TEXT_FONT,
  type InstrumentPalette,
} from '@meteor/ui/canvas';

export class AudioView {
  private readonly context: CanvasRenderingContext2D;
  private readonly palette: InstrumentPalette;
  private samples: Float32Array | null = null;
  public constructor(private readonly canvas: HTMLCanvasElement) {
    this.context = canvas.getContext('2d')!;
    this.palette = instrumentPalette(canvas);
    new ResizeObserver(() => this.draw()).observe(canvas);
    this.reset();
  }
  public reset(): void {
    this.samples = null;
    this.draw();
  }
  public update(samples: Float32Array): void {
    this.samples = samples;
    this.draw();
  }
  private draw(): void {
    const ctx = this.context;
    const size = fitCanvas(this.canvas, ctx);
    if (!size) return;
    const { width, height } = size;
    const colors = this.palette;
    const left = 16,
      plot = width - 32,
      middle = height / 2,
      amplitude = middle - 16;
    ctx.fillStyle = colors['--night'];
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = colors['--night-line'];
    ctx.lineWidth = 1;
    for (const fraction of [-1, -0.5, 0, 0.5, 1]) {
      const y = Math.round(middle - fraction * amplitude) + 0.5;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + plot, y);
      ctx.stroke();
    }
    const samples = this.samples;
    if (!samples) {
      const message = 'Audio appears here while the radio plays';
      ctx.font = `15px ${TEXT_FONT}`;
      // Clear the centre line behind the message so it does not read as struck through.
      const clear = ctx.measureText(message).width + 24;
      ctx.fillStyle = colors['--night'];
      ctx.fillRect((width - clear) / 2, middle - 12, clear, 24);
      ctx.fillStyle = colors['--night-ink'];
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(message, width / 2, middle);
      return;
    }
    ctx.strokeStyle = colors['--signal'];
    ctx.beginPath();
    // Peak envelope preserves short audio transients while bounding display work.
    for (let x = 0; x < plot; x++) {
      const from = Math.floor((x * samples.length) / plot);
      const to = Math.max(from + 1, Math.floor(((x + 1) * samples.length) / plot));
      let low = 0,
        high = 0;
      for (let i = from; i < Math.min(to, samples.length); i++) {
        low = Math.min(low, samples[i]!);
        high = Math.max(high, samples[i]!);
      }
      ctx.moveTo(left + x + 0.5, middle - Math.min(1, high) * amplitude);
      ctx.lineTo(left + x + 0.5, middle - Math.max(-1, low) * amplitude);
    }
    ctx.stroke();
  }
}
