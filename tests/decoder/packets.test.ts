import { describe, expect, test } from 'vitest';
import { PacketAssembler } from '@meteor/decoder/packets';
import { MeteorImage } from '@meteor/decoder/image';
import { decodeSegment } from '@meteor/decoder/segments';

function frame(count: number, pointer: number, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(1024);
  result.set([
    0x1a,
    0xcf,
    0xfc,
    0x1d,
    0x40,
    5,
    (count >>> 16) & 255,
    (count >>> 8) & 255,
    count & 255,
  ]);
  result[12] = pointer >>> 8;
  result[13] = pointer & 255;
  result.set(data, 14);
  return result;
}
describe('Bounded CCSDS packet assembly', () => {
  test('reassembles a split packet across counter wrap and ignores duplicates', () => {
    // Arrange
    const decoder = new PacketAssembler();
    const packet = new Uint8Array(1000).fill(123);
    packet.set([0, 64, 0, 4, 3, 225]); // 994 payload bytes, 1000 total.
    const first = frame(0xffffff, 0, packet.subarray(0, 882));
    const tail = frame(0, 0x7ff, packet.subarray(882));
    // Act
    expect(decoder.push(first)).toEqual([]);
    const result = decoder.push(tail);
    // Assert
    expect(result[0]?.payload.length).toBe(994);
    expect(result[0]?.payload.every((value) => value === 123)).toBe(true);
    expect(decoder.push(tail)).toEqual([]);
    expect(decoder.gaps).toBe(0);
  });
  test('discards partial packets after lost frames and handles idle data', () => {
    // Arrange
    const decoder = new PacketAssembler();
    const packet = new Uint8Array(882);
    packet.set([0, 64, 0, 1, 3, 225]);
    // Act
    decoder.push(frame(4, 0, packet));
    const result = decoder.push(frame(6, 0x7ff, new Uint8Array(882)));
    decoder.push(frame(7, 0x7fe, new Uint8Array(0)));
    // Assert
    expect(result).toEqual([]);
    expect(decoder.gaps).toBe(1);
    expect(() => decoder.push(new Uint8Array(5))).toThrow();
    expect(decoder.push(new Uint8Array(1024))).toEqual([]);
    decoder.push(frame(8, 999, new Uint8Array(0)));
    expect(decoder.rejected).toBe(2);
  });
  test('rejects malformed image packets without generating an image', () => {
    // Arrange
    const image = new MeteorImage();
    // Act
    image.push({ apid: 10, sequence: 0, payload: new Uint8Array(0) });
    image.push({ apid: 64, sequence: 0, payload: new Uint8Array(2) });
    // Assert
    expect(image.snapshot()).toBeNull();
    expect(image.rejected).toBe(1);
    expect(() => decodeSegment(new Uint8Array(14))).toThrow();
  });
});
