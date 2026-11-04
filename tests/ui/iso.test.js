import { describe, it, expect } from 'vitest';
import { project, unproject, pickTile, tileCenter, tileDiamond, visibleTileRange, mapBounds, TILE_W, TILE_H } from '../../src/ui/render/iso.js';

describe('iso projection', () => {
  it('projects using sx=(x−y)·TW/2, sy=(x+y)·TH/2', () => {
    expect(project(0, 0)).toEqual({ x: 0, y: 0 });
    expect(project(1, 0)).toEqual({ x: TILE_W / 2, y: TILE_H / 2 });
    expect(project(0, 1)).toEqual({ x: -TILE_W / 2, y: TILE_H / 2 });
    expect(project(3, 5)).toEqual({ x: -2 * TILE_W / 2, y: 8 * TILE_H / 2 });
  });

  it('unproject is the exact inverse', () => {
    for (const [u, v] of [[0, 0], [1.25, 7.5], [127.9, 0.1], [64, 64], [-3, 2]]) {
      const p = project(u, v);
      const q = unproject(p.x, p.y);
      expect(q.u).toBeCloseTo(u, 10);
      expect(q.v).toBeCloseTo(v, 10);
    }
  });

  it('picks the tile whose centre is under the cursor', () => {
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const c = tileCenter(x, y);
        expect(pickTile(c.x, c.y)).toEqual({ x, y });
      }
    }
  });

  it('picks correctly just inside each diamond edge', () => {
    const x = 5, y = 9;
    const [tx, ty, rx, ry, bx, by, lx, ly] = tileDiamond(x, y);
    const c = tileCenter(x, y);
    const e = 0.01; // 1% toward the centre from each vertex
    for (const [vx, vy] of [[tx, ty], [rx, ry], [bx, by], [lx, ly]]) {
      const px = vx + (c.x - vx) * e;
      const py = vy + (c.y - vy) * e;
      expect(pickTile(px, py)).toEqual({ x, y });
    }
  });

  it('picks the neighbour just across an edge', () => {
    // Midpoint of the top-right edge (shared with the north neighbour y−1)
    const [tx, ty, rx, ry] = tileDiamond(4, 4);
    const mx = (tx + rx) / 2, my = (ty + ry) / 2;
    expect(pickTile(mx, my + 0.5)).toEqual({ x: 4, y: 4 });
    expect(pickTile(mx, my - 0.5)).toEqual({ x: 4, y: 3 });
  });

  it('computes a visible range clamped to the map', () => {
    const b = mapBounds(128, 128);
    const all = visibleTileRange(b, 128, 128, 0);
    expect(all).toEqual({ x0: 0, y0: 0, x1: 127, y1: 127 });
    const c = tileCenter(64, 64);
    const r = visibleTileRange({ minX: c.x - 10, maxX: c.x + 10, minY: c.y - 10, maxY: c.y + 10 }, 128, 128, 0);
    expect(r.x0).toBeLessThanOrEqual(64);
    expect(r.x1).toBeGreaterThanOrEqual(64);
    expect(r.x1 - r.x0).toBeLessThan(4);
  });
});
