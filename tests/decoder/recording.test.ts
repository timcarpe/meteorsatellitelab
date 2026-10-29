import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { PacketAssembler } from '@meteor/decoder/packets';
import { MeteorImage } from '@meteor/decoder/image';
import golden from '../fixtures/image-golden.json';

describe('Independent Meteor recording', () => {
  test('reconstructs real MSU-MR image segments without malformed packets', () => {
    // Arrange
    const recording = readFileSync('tests/fixtures/meteor-recording.cadu');
    const assembler = new PacketAssembler();
    const image = new MeteorImage();
    // Act
    for (let offset = 0; offset < recording.length; offset += 1024) {
      for (const packet of assembler.push(recording.subarray(offset, offset + 1024))) {
        image.push(packet);
      }
    }
    const result = image.snapshot();
    // Assert
    console.log({
      frames: assembler.frames,
      gaps: assembler.gaps,
      packetErrors: assembler.rejected,
      segments: image.segments,
      imageErrors: image.rejected,
      width: result?.width,
      height: result?.height,
      channels: result?.channels,
    });
    expect(result).not.toBeNull();
    expect(image.segments).toBeGreaterThan(100);
    expect(image.rejected).toBe(0);
    expect(assembler.rejected).toBe(0);
    expect(result?.width).toBe(1568);
    for (const reference of golden.samples) {
      const channel = image.snapshot(reference.channel)!;
      let totalError = 0;
      for (const [x, y, pixel] of reference.pixels) {
        const value = channel.rgba[(y! * channel.width + x!) * 4]!;
        expect(Math.abs(value - pixel!)).toBeLessThanOrEqual(2);
        totalError += Math.abs(value - pixel!);
      }
      expect(totalError / reference.pixels.length).toBeLessThan(0.5);
    }
    expect(() => image.snapshot(6)).toThrow();
  });
});
