/** Typed boundary for the compiled, self-contained WebAssembly artifact. */
import createDecoder from '@meteor/decoder/generated/meteor-wasm.js';
import { StationError } from '@meteor/core/errors';

interface NativeDecoder {
  readonly HEAPU8: Uint8Array;
  _malloc(length: number): number;
  _free(pointer: number): void;
  _station_init(sampleRate: number): number;
  _station_iq(pointer: number, length: number): number;
  _station_soft(pointer: number, length: number): number;
  _station_frames(): number;
  _station_finish(): number;
  _station_carrier_offset(): number;
}

export class WasmDecoder {
  private readonly pointer: number;
  private constructor(
    private readonly native: NativeDecoder,
    rate: number,
  ) {
    if (native._station_init(rate) !== 0)
      throw new StationError('The Meteor decoder could not initialize.');
    this.pointer = native._malloc(262144);
    if (!this.pointer)
      throw new StationError('There is not enough memory to start the decoder.');
  }
  public static async create(rate: number): Promise<WasmDecoder> {
    const native = await createDecoder({
      print: () => {},
      printErr: (message: string) => console.error('Meteor decoder:', message),
    });
    return new WasmDecoder(native as NativeDecoder, rate);
  }
  public push(bytes: Uint8Array, format: 'iq' | 'soft' = 'iq'): Uint8Array[] {
    if (bytes.length > 262144)
      throw new StationError('The radio block exceeds the decoder buffer limit.');
    this.native.HEAPU8.set(bytes, this.pointer);
    const count =
      format === 'iq'
        ? this.native._station_iq(this.pointer, bytes.length)
        : this.native._station_soft(this.pointer, bytes.length);
    if (count < 0)
      throw new StationError(
        `The decoder rejected a radio block (${count}). Stop and reconnect the receiver.`,
      );
    return this.readFrames(count);
  }
  public finish(): Uint8Array[] {
    return this.readFrames(this.native._station_finish());
  }
  private readFrames(count: number): Uint8Array[] {
    if (count < 0)
      throw new StationError('The decoder could not finish the recording.');
    const start = this.native._station_frames();
    return Array.from({ length: count }, (_, i) =>
      this.native.HEAPU8.slice(start + i * 1024, start + (i + 1) * 1024),
    );
  }
  public get carrierOffset(): number {
    return this.native._station_carrier_offset();
  }
  public close(): void {
    this.native._free(this.pointer);
  }
}
