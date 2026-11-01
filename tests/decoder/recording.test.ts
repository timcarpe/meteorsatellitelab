import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { PacketAssembler, type SpacePacket } from '@meteor/decoder/packets';
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
    expect(result?.channel).toBe(1);
    for (const reference of golden.samples) {
      const channel = image.snapshot(reference.channel)!;
      expect(channel.channel).toBe(reference.channel);
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

  test('tags the rendered channel as channels arrive and after a new session', () => {
    // Use real, independently recorded image packets for two channels.
    const recording = readFileSync('tests/fixtures/meteor-recording.cadu');
    const assembler = new PacketAssembler();
    const firstPackets: SpacePacket[] = [];
    for (
      let offset = 0;
      offset < recording.length && firstPackets.length < 2;
      offset += 1024
    ) {
      for (const packet of assembler.push(recording.subarray(offset, offset + 1024))) {
        if (packet.payload[8] !== 0) continue;
        if (firstPackets.length === 0 && packet.apid === 65) firstPackets.push(packet);
        else if (firstPackets.length === 1 && packet.apid === 64)
          firstPackets.push(packet);
      }
    }
    expect(firstPackets).toHaveLength(2);

    const image = new MeteorImage();
    image.push(firstPackets[0]!);
    expect(image.snapshot()?.channel).toBe(2);
    image.push(firstPackets[1]!);
    const defaultImage = image.snapshot()!;
    expect(defaultImage.channels).toEqual([1, 2]);
    expect(defaultImage.channel).toBe(1);
    expect(image.snapshot(2)?.channel).toBe(2);

    const nextSession = new MeteorImage();
    firstPackets.forEach((packet) => nextSession.push(packet));
    const restartedImage = nextSession.snapshot()!;
    expect(restartedImage.channel).toBe(1);
    expect(
      Buffer.from(restartedImage.rgba).equals(Buffer.from(defaultImage.rgba)),
    ).toBe(true);
  });
});
