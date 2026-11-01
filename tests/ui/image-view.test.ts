import { describe, expect, test } from 'vitest';
import { ImageView } from '@meteor/ui/image-view';
import type { ImageSnapshot } from '@meteor/decoder/image';

function viewFixture() {
  let rendered: Uint8ClampedArray | null = null;
  const select = {
    value: '',
    disabled: false,
    innerHTML: '',
  } as HTMLSelectElement;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: (image: ImageData) => {
        rendered = image.data;
      },
    }),
  } as unknown as HTMLCanvasElement;
  const view = new ImageView(canvas, select);
  return { view, select, canvas, pixels: () => rendered };
}

function snapshot(
  channel: number,
  channels: readonly number[] = [1, 2],
): ImageSnapshot {
  return {
    channel,
    channels,
    width: 1,
    height: 1,
    rgba: new Uint8ClampedArray([channel * 50, channel * 50, channel * 50, 255]),
    segments: 1,
    rejected: 0,
  };
}

describe('Rendered image channel', () => {
  test('resets the previous selection when a new recording starts', () => {
    const { view, select, canvas, pixels } = viewFixture();
    view.update(snapshot(1));
    select.value = '2';
    view.update(snapshot(2));
    expect(view.channel).toBe(2);
    expect(pixels()?.[0]).toBe(100);

    view.reset();
    expect(view.channel).toBeNull();
    expect(view.channels).toEqual([]);
    expect(select.innerHTML).toBe('');
    expect(select.disabled).toBe(true);
    expect(canvas.width).toBe(0);

    view.update(snapshot(1));
    expect(select.value).toBe('1');
    expect(select.disabled).toBe(false);
    expect(view.channel).toBe(1);
    expect(pixels()?.[0]).toBe(50);
  });

  test('keeps export metadata on the rendered channel while a selection is pending', () => {
    const { view, select, pixels } = viewFixture();
    view.update(snapshot(1));
    select.value = '2';
    expect(view.channel).toBe(1);
    expect(pixels()?.[0]).toBe(50);

    view.update(snapshot(2));
    expect(view.channel).toBe(2);
    expect(select.value).toBe('2');
    expect(pixels()?.[0]).toBe(100);
  });

  test('follows the rendered default when a newly received channel changes it', () => {
    const { view, select } = viewFixture();
    view.update(snapshot(2, [2]));
    expect(select.value).toBe('2');
    view.update(snapshot(1, [1, 2]));
    expect(view.channel).toBe(1);
    expect(select.value).toBe('1');
    expect(view.channels).toEqual([1, 2]);
  });
});
