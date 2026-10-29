/** Canvas instrumentation for measured IQ power and a bounded recent-history waterfall. */
export class SpectrumView {
  private readonly context: CanvasRenderingContext2D;
  private readonly history = document.createElement('canvas');
  private readonly historyContext: CanvasRenderingContext2D;
  private frequency = 137900000;
  private sampleRate = 288000;
  private bins: Float32Array | null = null;
  private emptyMessage = 'Start reception to view the signal';

  public constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.width = 1000;
    canvas.height = 340;
    this.context = canvas.getContext('2d')!;
    this.history.width = 512;
    this.history.height = 100;
    this.historyContext = this.history.getContext('2d')!;
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
    const left = 62,
      right = 974,
      top = 24,
      bottom = 180;
    ctx.fillStyle = '#132c31';
    ctx.fillRect(0, 0, 1000, 340);
    ctx.font = '20px ui-monospace, monospace';
    ctx.textAlign = 'right';
    for (const db of [0, -30, -60, -90]) {
      const y = top + (-db / 90) * (bottom - top);
      ctx.strokeStyle = '#2d4c49';
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.fillStyle = '#c6d6cc';
      ctx.fillText(`${db}`, left - 10, y + 5);
    }
    ctx.fillStyle = '#18343a';
    ctx.fillRect(left, 228, right - left, 100);
    if (this.bins) {
      ctx.strokeStyle = '#9cd8b7';
      ctx.lineWidth = 2;
      ctx.beginPath();
      this.bins.forEach((value, i) => {
        const x = left + (i / (this.bins!.length - 1)) * (right - left);
        const y = top + Math.max(0, Math.min(1, -value / 90)) * (bottom - top);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.drawImage(this.history, left, 228, right - left, 100);
    } else {
      ctx.fillStyle = '#c1d5c9';
      ctx.font = '23px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.emptyMessage, (left + right) / 2, 110);
    }
    ctx.font = '20px ui-monospace, monospace';
    ctx.fillStyle = '#c6d6cc';
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
      const offset = (fraction - 0.5) * this.sampleRate;
      const label =
        this.frequency > 0
          ? `${((this.frequency + offset) / 1e6).toFixed(3)}`
          : `${offset >= 0 ? '+' : ''}${(offset / 1000).toFixed(0)} kHz`;
      ctx.textAlign = fraction === 0 ? 'left' : fraction === 1 ? 'right' : 'center';
      ctx.fillText(label, left + fraction * (right - left), 208);
    }
  }
}
