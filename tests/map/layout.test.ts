import { describe, expect, test } from 'vitest';
import {
  mapFrame,
  overlapArea,
  placeLabel,
  textBox,
  unitsPerPixel,
} from '@meteor/map/layout';

describe('Map framing', () => {
  test('crops the regional view around the campus on narrow screens', () => {
    // Arrange / Act
    const phone = mapFrame('sunrise', 360);
    const tablet = mapFrame('sunrise', 700);
    const laptop = mapFrame('sunrise', 900);
    // Assert: the crop stays centred on the projection centre (x = 480).
    expect(phone.width).toBeLessThan(tablet.width);
    expect(tablet.width).toBeLessThan(laptop.width);
    for (const frame of [phone, tablet, laptop])
      expect(frame.x + frame.width / 2).toBe(480);
  });
  test('keeps the full world in the global view at any width', () => {
    expect(mapFrame('global', 360)).toEqual({ x: 0, y: 0, width: 960, height: 400 });
  });
  test('converts on-screen pixels to user units for constant text size', () => {
    // Arrange
    const frame = mapFrame('sunrise', 360);
    // Act
    const unit = unitsPerPixel(frame, 360);
    // Assert: 14 px text stays 14 px on screen after the SVG is scaled.
    expect(((14 * unit) / frame.width) * 360).toBeCloseTo(14);
  });
});

describe('Map label placement', () => {
  const bounds = { x: 0, y: 0, width: 960, height: 400 };
  const size = textBox('Meteor M2-4', 13);

  test('uses the preferred side when nothing is in the way', () => {
    // Act
    const placement = placeLabel([400, 200], size, 12, [], bounds);
    // Assert: below-right of the anchor.
    expect(placement.textAnchor).toBe('start');
    expect(placement.box.x).toBeGreaterThan(400);
    expect(placement.box.y).toBeGreaterThan(200);
  });
  test('moves away from an existing campus label instead of covering it', () => {
    // Arrange: the campus label occupies the preferred below-right slot.
    const campus = placeLabel([400, 200], textBox('VAS Sunrise', 14), 12, [], bounds);
    // Act: a satellite directly beside the campus.
    const satellite = placeLabel([404, 204], size, 12, [campus.box], bounds);
    // Assert
    expect(overlapArea(satellite.box, campus.box)).toBe(0);
  });
  test('stays inside the visible frame near its edge', () => {
    // Act: an anchor at the right-hand edge of a cropped frame.
    const frame = { x: 240, y: 0, width: 480, height: 400 };
    const placement = placeLabel([715, 30], size, 12, [], frame);
    // Assert
    expect(placement.box.x).toBeGreaterThanOrEqual(frame.x);
    expect(placement.box.x + placement.box.width).toBeLessThanOrEqual(
      frame.x + frame.width,
    );
    expect(placement.textAnchor).toBe('end');
  });
  test('falls back to the least-overlapping side when every side is taken', () => {
    // Arrange: crowd all four sides; leave the top-left side least covered.
    const blockers = [
      { x: 410, y: 200, width: 120, height: 40 },
      { x: 410, y: 160, width: 120, height: 40 },
      { x: 280, y: 200, width: 120, height: 40 },
      { x: 380, y: 180, width: 10, height: 10 },
    ];
    // Act
    const placement = placeLabel([400, 200], size, 12, blockers, bounds);
    const cost = blockers.reduce(
      (sum, box) => sum + overlapArea(placement.box, box),
      0,
    );
    // Assert
    expect(placement.textAnchor).toBe('end');
    expect(placement.box.y).toBeLessThan(200);
    expect(cost).toBeLessThan(size.width * size.height);
  });
});
