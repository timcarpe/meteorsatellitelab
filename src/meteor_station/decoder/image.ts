/** Assemble aligned MSU-MR channels without inventing pixels in missing strips. */
import type { SpacePacket } from '@meteor/decoder/packets';
import { decodeSegment } from '@meteor/decoder/segments';
import { StationError } from '@meteor/core/errors';

export const IMAGE_WIDTH = 1568;
const MAX_LINES = 8192;
const ROW_BYTES = IMAGE_WIDTH * 8;

export interface ImageSnapshot {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
  readonly channels: readonly number[];
  readonly segments: number;
  readonly rejected: number;
}

export class MeteorImage {
  private readonly rows = new Map<number, Map<number, Uint8Array>>();
  private firstSequence: number | null = null;
  private previousSequence: number | null = null;
  private wrap = 0;
  private maxRow = -1;
  public segments = 0;
  public rejected = 0;

  public push(packet: SpacePacket): void {
    if (packet.apid < 64 || packet.apid > 69) return;
    let segment;
    try {
      segment = decodeSegment(packet.payload);
    } catch {
      this.rejected++;
      return;
    }
    if (this.firstSequence === null) {
      if (segment.mcu !== 0) return;
      const channelOffset = packet.apid === 65 ? 14 : packet.apid >= 66 ? 28 : 0;
      this.firstSequence = packet.sequence - channelOffset;
    }
    if (
      this.previousSequence !== null &&
      packet.sequence < this.previousSequence - 8192
    )
      this.wrap += 16384;
    if (
      this.previousSequence !== null &&
      packet.sequence > this.previousSequence + 8192
    ) {
      this.rejected++;
      return; // Late packet from the preceding counter cycle.
    }
    this.previousSequence = packet.sequence;
    const row = Math.floor((packet.sequence + this.wrap - this.firstSequence) / 43);
    if (row < 0) {
      this.rejected++;
      return;
    }
    if (row * 8 >= MAX_LINES) {
      throw new StationError(
        'This recording reached the 8,192-line image limit. Save it and start a new reception.',
      );
    }
    const channel = packet.apid - 63;
    let channelRows = this.rows.get(channel);
    if (!channelRows) {
      channelRows = new Map();
      this.rows.set(channel, channelRows);
    }
    let strip = channelRows.get(row);
    if (!strip) {
      strip = new Uint8Array(ROW_BYTES);
      channelRows.set(row, strip);
    }
    for (let y = 0; y < 8; y++) {
      strip.set(
        segment.pixels.subarray(y * 112, (y + 1) * 112),
        y * IMAGE_WIDTH + segment.mcu * 8,
      );
    }
    this.maxRow = Math.max(this.maxRow, row);
    this.segments++;
  }

  public snapshot(channel?: number): ImageSnapshot | null {
    if (this.maxRow < 0) return null;
    const channels = [...this.rows.keys()].sort((a, b) => a - b);
    const height = (this.maxRow + 1) * 8;
    const rgba = new Uint8ClampedArray(IMAGE_WIDTH * height * 4);
    // A single real channel is useful in both daylight and darkness.
    const chosen = channel ?? (channels.includes(1) ? 1 : channels[0]!);
    const strips = this.rows.get(chosen);
    if (!strips) throw new StationError(`Channel ${chosen} has not been received.`);
    for (const [row, strip] of strips) {
      for (let i = 0; i < strip.length; i++) {
        const at = (row * ROW_BYTES + i) * 4;
        rgba[at] = strip[i]!;
        rgba[at + 1] = strip[i]!;
        rgba[at + 2] = strip[i]!;
        rgba[at + 3] = 255;
      }
    }
    return {
      width: IMAGE_WIDTH,
      height,
      rgba,
      channels,
      segments: this.segments,
      rejected: this.rejected,
    };
  }
}
