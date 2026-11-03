import { describe, expect, test } from 'vitest';
import {
  ChannelWatch,
  DEFAULT_CHANNEL_WATCH,
  lrptBandExcessDb,
} from '@meteor/radio/channel-watch';

const RATE = 288000;

/** A 512-bin dBFS spectrum: jittered noise, an optional LRPT-shaped hump and lines. */
function spectrum(humpDb = 0, lines: readonly number[] = [], seed = 1): Float32Array {
  let random = seed;
  return Float32Array.from({ length: 512 }, (_, i) => {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const offset = (i - 256) * (RATE / 512);
    let db = -60 + ((random / 2 ** 32) * 4 - 2);
    if (humpDb && Math.abs(offset) < 50000) db += humpDb;
    if (lines.some((line) => Math.abs(offset - line) < RATE / 512)) db += 25;
    return db;
  });
}

describe('LRPT band excess', () => {
  test('reads near zero for noise and the hump height for an LRPT-shaped signal', () => {
    // Act
    const noise = lrptBandExcessDb(spectrum(), RATE)!;
    const signal = lrptBandExcessDb(spectrum(3), RATE)!;
    // Assert
    expect(Math.abs(noise)).toBeLessThan(0.5);
    expect(signal).toBeGreaterThan(2.5);
    expect(signal).toBeLessThan(3.5);
  });
  test('ignores narrow interference lines inside and outside the band', () => {
    // Arrange: strong lines like those seen at fixed offsets on 137.1 MHz.
    const lines = [-102000, -42000, -63000, 12000, 80000];
    // Act
    const excess = lrptBandExcessDb(spectrum(0, lines), RATE)!;
    // Assert
    expect(Math.abs(excess)).toBeLessThan(0.5);
  });
  test('rejects spectra too small or with an invalid rate', () => {
    expect(lrptBandExcessDb(new Float32Array(16), RATE)).toBeNull();
    expect(lrptBandExcessDb(spectrum(), 0)).toBeNull();
  });
});

describe('Channel watch', () => {
  const feed = (watch: ChannelWatch, humpDb: number, from: number, count: number) => {
    let announced = 0;
    for (let i = 0; i < count; i++)
      if (watch.addSpectrum(spectrum(humpDb, [], i + 1), RATE, from + i * 100))
        announced++;
    return announced;
  };

  test('moves on after 45 s without frames or signal', () => {
    // Arrange
    const watch = new ChannelWatch();
    watch.reset(0);
    feed(watch, 0, 0, 60);
    // Act / Assert
    expect(watch.shouldHop(45000, 0)).toBe(false);
    expect(watch.shouldHop(45001, 0)).toBe(true);
    expect(watch.signalSeen).toBe(false);
  });
  test('stays while an LRPT-shaped signal is present and announces it once', () => {
    // Arrange
    const watch = new ChannelWatch();
    watch.reset(0);
    // Act
    const announced = feed(watch, 2, 40000, 100);
    // Assert: still present at 50 s, so no hop despite no decoded frames.
    expect(announced).toBe(1);
    expect(watch.signalSeen).toBe(true);
    expect(watch.shouldHop(50000, 0)).toBe(false);
  });
  test('moves on once a signal has been gone for the hold time', () => {
    // Arrange: signal until ~50 s, then noise.
    const watch = new ChannelWatch();
    watch.reset(0);
    feed(watch, 2, 40000, 100);
    feed(watch, 0, 50000, 100);
    const lastSignal = 50000 + 2900; // the 30-spectrum mean drops below threshold here
    // Act / Assert
    expect(watch.shouldHop(lastSignal + DEFAULT_CHANNEL_WATCH.holdMs - 1000, 0)).toBe(
      false,
    );
    expect(watch.shouldHop(lastSignal + DEFAULT_CHANNEL_WATCH.holdMs + 1000, 0)).toBe(
      true,
    );
  });
  test('never moves on while frames are decoding, and resets on retune', () => {
    // Arrange
    const watch = new ChannelWatch();
    watch.reset(0);
    feed(watch, 2, 0, 40);
    // Act / Assert
    expect(watch.shouldHop(600000, 3)).toBe(false);
    watch.reset(1000);
    expect(watch.signalSeen).toBe(false);
    expect(watch.shouldHop(46001, 0)).toBe(true);
  });
});
