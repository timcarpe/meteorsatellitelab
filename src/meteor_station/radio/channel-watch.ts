/**
 * Decide when an undecoded Meteor channel is worth staying on. This is a heuristic
 * for where to listen, not an identification of a satellite transmitter.
 */

/** Flat top of a 72 ksym/s LRPT spectrum, excluding the RTL-SDR DC spike. */
const IN_BAND_HZ: readonly [number, number] = [3000, 25000];
/**
 * Guard bands just outside LRPT's ~±58 kHz occupied bandwidth. Bands further out are
 * attenuated by the RTL-SDR's filter, which made noise alone read as ~1 dB excess.
 */
const GUARD_HZ: readonly [number, number] = [70000, 100000];

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const middle = values.length >> 1;
  return values.length % 2
    ? values[middle]!
    : (values[middle - 1]! + values[middle]!) / 2;
}

/**
 * In-band power over guard-band power, in dB, from a centred dBFS spectrum. Medians
 * keep narrow interference lines from looking like a broad LRPT-shaped signal.
 */
export function lrptBandExcessDb(
  bins: Float32Array,
  sampleRate: number,
): number | null {
  if (bins.length < 64 || !Number.isFinite(sampleRate) || sampleRate <= 0) return null;
  const binHz = sampleRate / bins.length;
  const inner: number[] = [];
  const guard: number[] = [];
  for (let i = 0; i < bins.length; i++) {
    const offset = Math.abs((i - bins.length / 2) * binHz);
    const value = bins[i]!;
    if (!Number.isFinite(value)) continue;
    if (offset >= IN_BAND_HZ[0] && offset <= IN_BAND_HZ[1]) inner.push(value);
    else if (offset >= GUARD_HZ[0] && offset <= GUARD_HZ[1]) guard.push(value);
  }
  if (inner.length < 8 || guard.length < 8) return null;
  return median(inner) - median(guard);
}

export interface ChannelWatchOptions {
  /** Time without frames or signal before trying the other channel. */
  readonly hopAfterMs: number;
  /** How long a detected signal keeps the receiver on its channel after it fades. */
  readonly holdMs: number;
  /** Mean band excess, over the averaging window, that counts as a signal. */
  readonly thresholdDb: number;
  /** Number of recent spectra averaged (the worker publishes up to ten a second). */
  readonly window: number;
}
export const DEFAULT_CHANNEL_WATCH: ChannelWatchOptions = Object.freeze({
  hopAfterMs: 45000,
  holdMs: 30000,
  thresholdDb: 0.6,
  window: 30,
});

/** Tracks one tuning: decoded frames or an LRPT-shaped signal keep it; silence moves on. */
export class ChannelWatch {
  private tunedAt = 0;
  private signalAt = -Infinity;
  private recent: number[] = [];
  private announced = false;

  public constructor(private readonly options = DEFAULT_CHANNEL_WATCH) {}

  public reset(now: number): void {
    this.tunedAt = now;
    this.signalAt = -Infinity;
    this.recent = [];
    this.announced = false;
  }

  /** Feed one spectrum. Returns true the first time a signal is seen on this tuning. */
  public addSpectrum(bins: Float32Array, sampleRate: number, now: number): boolean {
    const excess = lrptBandExcessDb(bins, sampleRate);
    if (excess === null) return false;
    this.recent.push(excess);
    if (this.recent.length > this.options.window) this.recent.shift();
    if (this.recent.length < this.options.window) return false;
    const mean =
      this.recent.reduce((sum, value) => sum + value, 0) / this.recent.length;
    if (mean < this.options.thresholdDb) return false;
    this.signalAt = now;
    if (this.announced) return false;
    this.announced = true;
    return true;
  }

  public get signalSeen(): boolean {
    return this.signalAt > -Infinity;
  }

  /** Whether to move to the other Meteor channel now. */
  public shouldHop(now: number, frames: number): boolean {
    if (frames > 0) return false;
    if (now - this.tunedAt <= this.options.hopAfterMs) return false;
    return now - this.signalAt > this.options.holdMs;
  }
}
