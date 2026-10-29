/** Reassemble CCSDS packets from corrected Meteor CADUs; discard gaps safely. */
import { StationError } from '@meteor/core/errors';

export interface SpacePacket {
  readonly apid: number;
  readonly sequence: number;
  readonly payload: Uint8Array;
}

const DATA_START = 14;
const DATA_END = 896;
const MAX_PACKET = 8192;

export class PacketAssembler {
  private previous: number | null = null;
  private partial = new Uint8Array(0);
  public gaps = 0;
  public frames = 0;
  public rejected = 0;

  public push(cadu: Uint8Array): SpacePacket[] {
    if (cadu.length !== 1024)
      throw new StationError('A Meteor CADU must be 1024 bytes.');
    if (cadu[0] !== 0x1a || cadu[1] !== 0xcf || cadu[2] !== 0xfc || cadu[3] !== 0x1d) {
      this.rejected++;
      return [];
    }
    this.frames++;
    if (cadu[4]! >> 6 !== 1 || (cadu[5]! & 63) !== 5) return [];
    const counter = (cadu[6]! << 16) | (cadu[7]! << 8) | cadu[8]!;
    if (counter === this.previous) return [];
    const contiguous =
      this.previous !== null && counter === ((this.previous + 1) & 0xffffff);
    if (!contiguous) {
      if (this.previous !== null) this.gaps++;
      this.partial = new Uint8Array(0);
    }
    this.previous = counter;
    const pointer = ((cadu[12]! & 7) << 8) | cadu[13]!;
    if (pointer === 0x7fe) {
      this.partial = new Uint8Array(0);
      return [];
    }
    if (pointer !== 0x7ff && pointer >= DATA_END - DATA_START) {
      this.partial = new Uint8Array(0);
      this.rejected++;
      return [];
    }
    const packets: SpacePacket[] = [];
    const data = cadu.subarray(DATA_START, DATA_END);
    if (this.partial.length && contiguous) {
      const prefix = pointer === 0x7ff ? data : data.subarray(0, pointer);
      const joined = new Uint8Array(this.partial.length + prefix.length);
      joined.set(this.partial);
      joined.set(prefix, this.partial.length);
      this.partial = new Uint8Array(0);
      this.consume(joined, packets);
      if (pointer !== 0x7ff) this.partial = new Uint8Array(0);
    }
    if (pointer !== 0x7ff) this.consume(data.subarray(pointer), packets);
    return packets;
  }

  private consume(data: Uint8Array, packets: SpacePacket[]): void {
    let offset = 0;
    while (offset < data.length) {
      const remaining = data.length - offset;
      if (remaining < 6) {
        this.partial = data.slice(offset);
        return;
      }
      const length = ((data[offset + 4]! << 8) | data[offset + 5]!) + 7;
      const version = data[offset]! >> 5;
      if (version !== 0 || length > MAX_PACKET) {
        this.rejected++;
        this.partial = new Uint8Array(0);
        return;
      }
      if (remaining < length) {
        this.partial = data.slice(offset);
        return;
      }
      packets.push(
        Object.freeze({
          apid: ((data[offset]! & 7) << 8) | data[offset + 1]!,
          sequence: ((data[offset + 2]! & 63) << 8) | data[offset + 3]!,
          payload: data.slice(offset + 6, offset + length),
        }),
      );
      offset += length;
    }
  }
}
