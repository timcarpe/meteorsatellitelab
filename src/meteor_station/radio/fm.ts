/** Mono broadcast-FM check: quadrature discriminator, low-pass and de-emphasis. */
import { requireFinite, StationError } from '@meteor/core/errors';

export interface RadioLevel {
  readonly rms: number;
  readonly clippedFraction: number;
  readonly samples: number;
}
export function measureIq(iq: Uint8Array): RadioLevel {
  if (iq.length % 2) throw new StationError('An IQ block must contain I/Q pairs.');
  let power = 0;
  let clipped = 0;
  for (const byte of iq) {
    power += ((byte - 127.5) / 127.5) ** 2;
    if (byte < 3 || byte > 252) clipped++;
  }
  return {
    rms: iq.length ? Math.sqrt(power / iq.length) : 0,
    clippedFraction: iq.length ? clipped / iq.length : 0,
    samples: iq.length / 2,
  };
}

export class FmCheck {
  private previousI = 0;
  private previousQ = 0;
  private previousInput = 0;
  private dc = 0;
  private deemphasis = 0;
  private phase = 0;
  private index = 0;
  private readonly taps = new Float64Array(65);
  private readonly history = new Float64Array(65);
  private readonly alpha: number;

  public constructor(
    private readonly sampleRate: number,
    private readonly outputRate = 48000,
  ) {
    requireFinite(sampleRate, 'FM input sample rate', 225000, 300000);
    this.alpha = 1 - Math.exp(-1 / (sampleRate * 50e-6));
    let sum = 0;
    for (let i = 0; i < this.taps.length; i++) {
      const t = i - 32;
      const cutoff = 15000 / sampleRate;
      const sinc =
        t === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * t) / (Math.PI * t);
      this.taps[i] =
        sinc *
        (0.42 -
          0.5 * Math.cos((2 * Math.PI * i) / 64) +
          0.08 * Math.cos((4 * Math.PI * i) / 64));
      sum += this.taps[i]!;
    }
    for (let i = 0; i < this.taps.length; i++) this.taps[i] = this.taps[i]! / sum;
  }

  public push(iq: Uint8Array): Float32Array {
    if (iq.length % 2)
      throw new StationError('FM input must contain complete I/Q pairs.');
    const output: number[] = [];
    for (let n = 0; n < iq.length; n += 2) {
      const i = iq[n]! - 127.5;
      const q = iq[n + 1]! - 127.5;
      const angle = Math.atan2(
        q * this.previousI - i * this.previousQ,
        i * this.previousI + q * this.previousQ,
      );
      this.previousI = i;
      this.previousQ = q;
      const value = (angle * this.sampleRate) / (2 * Math.PI * 75000);
      this.dc = value - this.previousInput + 0.999 * this.dc;
      this.previousInput = value;
      this.deemphasis += this.alpha * (this.dc - this.deemphasis);
      this.history[this.index] = this.deemphasis;
      this.index = (this.index + 1) % this.history.length;
      this.phase += this.outputRate;
      if (this.phase >= this.sampleRate) {
        this.phase -= this.sampleRate;
        let sum = 0;
        for (let k = 0; k < this.taps.length; k++) {
          sum += this.taps[k]! * this.history[(this.index + k) % this.history.length]!;
        }
        output.push(Math.max(-1, Math.min(1, sum)));
      }
    }
    return new Float32Array(output);
  }
}
