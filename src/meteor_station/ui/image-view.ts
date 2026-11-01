/** Keep the channel selector and export state tied to the pixels on the canvas. */
import type { ImageSnapshot } from '@meteor/decoder/image';

export class ImageView {
  private readonly context: CanvasRenderingContext2D;
  private availableChannels: readonly number[] = [];
  private renderedChannel: number | null = null;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly select: HTMLSelectElement,
  ) {
    this.context = canvas.getContext('2d')!;
    this.reset();
  }

  public get channels(): readonly number[] {
    return this.availableChannels;
  }

  /** A requested selection is not authoritative until its image arrives. */
  public get channel(): number | null {
    return this.renderedChannel;
  }

  public reset(): void {
    this.availableChannels = [];
    this.renderedChannel = null;
    this.select.innerHTML = '';
    this.select.disabled = true;
    this.canvas.width = 0;
    this.canvas.height = 0;
  }

  public update(image: ImageSnapshot): void {
    this.canvas.width = image.width;
    this.canvas.height = image.height;
    const pixels = this.context.createImageData(image.width, image.height);
    pixels.data.set(image.rgba);
    this.context.putImageData(pixels, 0, 0);
    if (this.availableChannels.join(',') !== image.channels.join(',')) {
      this.select.innerHTML = image.channels
        .map((channel) => `<option value="${channel}">${channel}</option>`)
        .join('');
      this.availableChannels = [...image.channels];
    }
    this.renderedChannel = image.channel;
    this.select.value = String(image.channel);
    this.select.disabled = false;
  }
}
