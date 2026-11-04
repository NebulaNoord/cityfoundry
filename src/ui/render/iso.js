// Isometric projection. Pure math, no PixiJS.
//
// A continuous map point (u, v) (u east, v south, in tiles) projects to world
// pixels as  sx = (u − v)·TW/2,  sy = (u + v)·TH/2.
// Tile (x, y) covers u∈[x,x+1), v∈[y,y+1); its diamond's top vertex is at
// project(x, y) and its centre at project(x + 0.5, y + 0.5).

export const TILE_W = 64;
export const TILE_H = 32;
const HW = TILE_W / 2;
const HH = TILE_H / 2;

export function project(u, v) {
  return { x: (u - v) * HW, y: (u + v) * HH };
}

/** Inverse projection: world pixels → continuous map coordinates. */
export function unproject(sx, sy) {
  const a = sx / HW;
  const b = sy / HH;
  return { u: (a + b) / 2, v: (b - a) / 2 };
}

/** World pixels → integer tile (may be out of bounds; caller checks). */
export function pickTile(sx, sy) {
  const { u, v } = unproject(sx, sy);
  return { x: Math.floor(u), y: Math.floor(v) };
}

export function tileCenter(x, y) {
  return project(x + 0.5, y + 0.5);
}

/** The four diamond vertices of tile (x,y): top, right, bottom, left. */
export function tileDiamond(x, y) {
  const t = project(x, y);
  return [t.x, t.y, t.x + HW, t.y + HH, t.x, t.y + TILE_H, t.x - HW, t.y + HH];
}

/** World-pixel bounding box of a tile rect [x0..x1]×[y0..y1] (inclusive tiles). */
export function rectBounds(x0, y0, x1, y1) {
  const top = project(x0, y0);
  const right = project(x1 + 1, y0);
  const bottom = project(x1 + 1, y1 + 1);
  const left = project(x0, y1 + 1);
  return { minX: left.x, maxX: right.x, minY: top.y, maxY: bottom.y };
}

/** Bounds of the whole map in world pixels. */
export function mapBounds(width, height) {
  return rectBounds(0, 0, width - 1, height - 1);
}

/**
 * Tile rect (inclusive, clamped) whose diamonds can intersect a world-pixel
 * view rectangle. `pad` extra tiles cover tall buildings poking into view.
 */
export function visibleTileRange(view, width, height, pad = 2) {
  const corners = [
    unproject(view.minX, view.minY),
    unproject(view.maxX, view.minY),
    unproject(view.minX, view.maxY),
    unproject(view.maxX, view.maxY),
  ];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const c of corners) {
    u0 = Math.min(u0, c.u); u1 = Math.max(u1, c.u);
    v0 = Math.min(v0, c.v); v1 = Math.max(v1, c.v);
  }
  return {
    x0: Math.max(0, Math.floor(u0) - pad),
    y0: Math.max(0, Math.floor(v0) - pad),
    x1: Math.min(width - 1, Math.floor(u1) + pad),
    y1: Math.min(height - 1, Math.floor(v1) + pad),
  };
}
