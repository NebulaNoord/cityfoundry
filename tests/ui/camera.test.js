import { describe, it, expect } from 'vitest';
import { clampCamera, zoomAt, panByScreen, screenToWorld, worldToScreen, MIN_ZOOM, MAX_ZOOM } from '../../src/ui/render/camera.js';

const bounds = { minX: -1000, maxX: 1000, minY: 0, maxY: 800 };

describe('camera', () => {
  it('screen↔world are inverses', () => {
    const cam = { x: 120, y: -40, zoom: 1.7 };
    const w = screenToWorld(cam, 1280, 720, 300, 500);
    const s = worldToScreen(cam, 1280, 720, w.x, w.y);
    expect(s.x).toBeCloseTo(300, 9);
    expect(s.y).toBeCloseTo(500, 9);
  });

  it('clamps centre and zoom', () => {
    expect(clampCamera({ x: 5000, y: -50, zoom: 10 }, bounds)).toEqual({ x: 1000, y: 0, zoom: MAX_ZOOM });
    expect(clampCamera({ x: -5000, y: 900, zoom: 0.01 }, bounds)).toEqual({ x: -1000, y: 800, zoom: MIN_ZOOM });
  });

  it('zooms keeping the world point under the cursor fixed', () => {
    const cam = { x: 100, y: 200, zoom: 1 };
    const sx = 900, sy = 150;
    const before = screenToWorld(cam, 1280, 720, sx, sy);
    const next = zoomAt(cam, 1280, 720, sx, sy, 1.5);
    const after = screenToWorld(next, 1280, 720, sx, sy);
    expect(next.zoom).toBeCloseTo(1.5);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('zoom at centre does not move the camera', () => {
    const next = zoomAt({ x: 10, y: 20, zoom: 1 }, 800, 600, 400, 300, 2);
    expect(next.x).toBeCloseTo(10);
    expect(next.y).toBeCloseTo(20);
  });

  it('zoom is clamped and stays anchored at the limit', () => {
    const next = zoomAt({ x: 0, y: 0, zoom: 2.9 }, 800, 600, 100, 100, 4);
    expect(next.zoom).toBe(MAX_ZOOM);
  });

  it('pans with the cursor and clamps to bounds', () => {
    const cam = { x: 0, y: 400, zoom: 2 };
    expect(panByScreen(cam, 100, -50, bounds)).toEqual({ x: -50, y: 425, zoom: 2 });
    expect(panByScreen(cam, -1e6, 0, bounds).x).toBe(1000);
  });
});
