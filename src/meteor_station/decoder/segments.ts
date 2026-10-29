/** Convert a Meteor 14-block MSU-MR segment to a bounded baseline JPEG. */
import jpeg from 'jpeg-js';
import { StationError } from '@meteor/core/errors';

const QUANT = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40,
  57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35,
  55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112,
  100, 103, 99,
];
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41,
  34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30,
  37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];
const DC_COUNTS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const AC_COUNTS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 125];
const AC_VALUES = [
  1, 2, 3, 0, 4, 17, 5, 18, 33, 49, 65, 6, 19, 81, 97, 7, 34, 113, 20, 50, 129, 145,
  161, 8, 35, 66, 177, 193, 21, 82, 209, 240, 36, 51, 98, 114, 130, 9, 10, 22, 23, 24,
  25, 26, 37, 38, 39, 40, 41, 42, 52, 53, 54, 55, 56, 57, 58, 67, 68, 69, 70, 71, 72,
  73, 74, 83, 84, 85, 86, 87, 88, 89, 90, 99, 100, 101, 102, 103, 104, 105, 106, 115,
  116, 117, 118, 119, 120, 121, 122, 131, 132, 133, 134, 135, 136, 137, 138, 146, 147,
  148, 149, 150, 151, 152, 153, 154, 162, 163, 164, 165, 166, 167, 168, 169, 170, 178,
  179, 180, 181, 182, 183, 184, 185, 186, 194, 195, 196, 197, 198, 199, 200, 201, 202,
  210, 211, 212, 213, 214, 215, 216, 217, 218, 225, 226, 227, 228, 229, 230, 231, 232,
  233, 234, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250,
];

function marker(id: number, payload: number[]): number[] {
  const size = payload.length + 2;
  return [0xff, id, size >> 8, size & 255, ...payload];
}

export interface ImageSegment {
  readonly mcu: number;
  readonly quality: number;
  readonly pixels: Uint8Array;
}

export function decodeSegment(payload: Uint8Array): ImageSegment {
  if (
    payload.length < 15 ||
    payload.length > 8186 ||
    payload[8]! > 182 ||
    payload[8]! % 14 !== 0 ||
    payload[9] !== 0 ||
    payload[10] !== 0 ||
    payload[11] !== 0xff ||
    payload[12] !== 0xf0 ||
    payload[13]! < 1 ||
    payload[13]! > 100
  ) {
    throw new StationError('Invalid MSU-MR image segment header.');
  }
  const quality = payload[13]!;
  const scale = quality > 20 && quality < 50 ? 5000 / quality : 200 - 2 * quality;
  const quantization = ZIGZAG.map((i) =>
    Math.max(1, Math.min(255, Math.round((QUANT[i]! * scale) / 100))),
  );
  const entropy: number[] = [];
  for (const byte of payload.subarray(14)) {
    entropy.push(byte);
    if (byte === 255) entropy.push(0); // LRPT does not use JPEG byte stuffing.
  }
  const data = new Uint8Array([
    0xff,
    0xd8,
    ...marker(0xdb, [0, ...quantization]),
    ...marker(0xc0, [8, 0, 8, 0, 112, 1, 1, 0x11, 0]),
    ...marker(0xc4, [
      0,
      ...DC_COUNTS,
      ...Array.from({ length: 12 }, (_, i) => i),
      0x10,
      ...AC_COUNTS,
      ...AC_VALUES,
    ]),
    ...marker(0xda, [1, 1, 0, 0, 63, 0]),
    ...entropy,
    0xff,
    0xd9,
  ]);
  const decoded = jpeg.decode(data, {
    useTArray: true,
    formatAsRGBA: false,
    tolerantDecoding: false,
    maxResolutionInMP: 1,
    maxMemoryUsageInMB: 16,
  });
  if (decoded.width !== 112 || decoded.height !== 8) {
    throw new StationError('Unexpected MSU-MR segment dimensions.');
  }
  const pixels = new Uint8Array(112 * 8);
  for (let i = 0; i < pixels.length; i++) pixels[i] = decoded.data[i * 3]!;
  return Object.freeze({ mcu: payload[8]!, quality, pixels });
}
