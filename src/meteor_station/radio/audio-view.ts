/** A received-audio waveform; no animated or synthesized placeholder data. */
export class AudioView {
  private readonly context: CanvasRenderingContext2D;
  public constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.width = 800;
    canvas.height = 260;
    this.context = canvas.getContext('2d')!;
    this.reset();
  }
  public reset(): void {
    this.background();
    this.context.fillStyle = '#c1d5c9';
    this.context.font = '20px Arial, sans-serif';
    this.context.textAlign = 'center';
    this.context.fillText('Waiting for radio audio', 400, 134);
  }
  public update(samples: Float32Array): void {
    this.background();
    const ctx = this.context;
    ctx.strokeStyle = '#9cd8b7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Peak envelope preserves short audio transients while bounding display work.
    for (let x = 0; x < 760; x++) {
      const from = Math.floor((x * samples.length) / 760);
      const to = Math.max(from + 1, Math.floor(((x + 1) * samples.length) / 760));
      let low = 0,
        high = 0;
      for (let i = from; i < Math.min(to, samples.length); i++) {
        low = Math.min(low, samples[i]!);
        high = Math.max(high, samples[i]!);
      }
      ctx.moveTo(20 + x, 130 - Math.min(1, high) * 100);
      ctx.lineTo(20 + x, 130 - Math.max(-1, low) * 100);
    }
    ctx.stroke();
  }
  private background(): void {
    const ctx = this.context;
    ctx.fillStyle = '#132c31';
    ctx.fillRect(0, 0, 800, 260);
    ctx.strokeStyle = '#2d4c49';
    ctx.lineWidth = 1;
    for (const y of [30, 80, 130, 180, 230]) {
      ctx.beginPath();
      ctx.moveTo(20, y);
      ctx.lineTo(780, y);
      ctx.stroke();
    }
  }
}
