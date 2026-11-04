// Drawing primitives in tile ("uv") space, projected to world pixels.
// P(u, v, h) = iso(u, v) lifted by h pixels. Everything the renderer draws on
// the map goes through these so geometry stays consistent with picking.
import { TILE_W, TILE_H } from './iso.js';

const HW = TILE_W / 2;
const HH = TILE_H / 2;

export function P(u, v, h = 0) {
  return [(u - v) * HW, (u + v) * HH - h];
}

/** Flat polygon from uv points [[u,v],...] at height h. */
export function uvPoly(pts, h = 0) {
  const out = [];
  for (const [u, v] of pts) out.push(...P(u, v, h));
  return out;
}

export function fillPoly(g, pts, color, alpha = 1) {
  g.poly(pts, true).fill({ color, alpha });
}

/** Flat rectangle u0..u1 × v0..v1 at height h. */
export function rectPoly(u0, v0, u1, v1, h = 0) {
  return [...P(u0, v0, h), ...P(u1, v0, h), ...P(u1, v1, h), ...P(u0, v1, h)];
}

// ---- colour helpers (0xRRGGBB ints) ----
export function shade(c, f) {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

export function mix(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Deterministic hash of integers → [0, 1). */
export function hash2(x, y, salt = 0) {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---- boxes ----
// Visible faces with our projection: the south face (v = v1) appears on the
// left, the east face (u = u1) on the right, plus the top.

export const LIGHT = { top: 1.0, left: 0.84, right: 0.64 };

/** A light (dir) used for ground shadows: ground offset per pixel of height. */
const SUN_U = 0.024;
const SUN_V = -0.006;

function hull(points) {
  // Monotone chain on [x,y] pairs.
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Ground shadow of a box of height h (pixels) over footprint. */
export function boxShadow(g, u0, v0, u1, v1, h, alpha = 0.24) {
  const du = SUN_U * h, dv = SUN_V * h;
  const pts = [];
  for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]) {
    pts.push(P(u, v), P(u + du, v + dv));
  }
  const hl = hull(pts);
  g.poly(hl.flat(), true).fill({ color: 0x10140f, alpha });
}

/** Extruded box from z0 to z1 (pixels). Colors: { top, left, right } or a single base. */
export function box(g, u0, v0, u1, v1, z0, z1, base, opts = {}) {
  const top = opts.top ?? shade(base, LIGHT.top);
  const left = opts.left ?? shade(base, LIGHT.left);
  const right = opts.right ?? shade(base, LIGHT.right);
  // south face (left on screen)
  g.poly([...P(u0, v1, z0), ...P(u1, v1, z0), ...P(u1, v1, z1), ...P(u0, v1, z1)], true).fill(left);
  // east face (right on screen)
  g.poly([...P(u1, v0, z0), ...P(u1, v1, z0), ...P(u1, v1, z1), ...P(u1, v0, z1)], true).fill(right);
  if (!opts.noTop) g.poly(rectPoly(u0, v0, u1, v1, z1), true).fill(top);
  if (opts.edge) {
    // crisp vertical front edge + top outline for definition
    g.moveTo(...P(u1, v1, z0)).lineTo(...P(u1, v1, z1)).stroke({ width: 0.6, color: opts.edge, alpha: 0.5 });
  }
}

/** Parallelogram on the south face (v = v): u range × height range. */
export function southFaceRect(g, v, ua, ub, za, zb, color, alpha = 1) {
  g.poly([...P(ua, v, za), ...P(ub, v, za), ...P(ub, v, zb), ...P(ua, v, zb)], true).fill({ color, alpha });
}

/** Parallelogram on the east face (u = u): v range × height range. */
export function eastFaceRect(g, u, va, vb, za, zb, color, alpha = 1) {
  g.poly([...P(u, va, za), ...P(u, vb, za), ...P(u, vb, zb), ...P(u, va, zb)], true).fill({ color, alpha });
}

/**
 * Gable roof over a box top at height z, ridge height rh above it.
 * alongU: ridge runs along u (east–west) when true, else along v.
 */
export function gableRoof(g, u0, v0, u1, v1, z, rh, roof, wall, alongU) {
  const top = z + rh;
  if (alongU) {
    const m = (v0 + v1) / 2;
    g.poly([...P(u0, v0, z), ...P(u1, v0, z), ...P(u1, m, top), ...P(u0, m, top)], true).fill(shade(roof, 1.08));
    g.poly([...P(u1, v0, z), ...P(u1, v1, z), ...P(u1, m, top)], true).fill(shade(wall, LIGHT.right));
    g.poly([...P(u0, m, top), ...P(u1, m, top), ...P(u1, v1, z), ...P(u0, v1, z)], true).fill(shade(roof, 0.86));
    g.moveTo(...P(u0, m, top)).lineTo(...P(u1, m, top)).stroke({ width: 0.8, color: shade(roof, 1.25), alpha: 0.8 });
  } else {
    const m = (u0 + u1) / 2;
    g.poly([...P(u0, v0, z), ...P(m, v0, top), ...P(m, v1, top), ...P(u0, v1, z)], true).fill(shade(roof, 1.08));
    g.poly([...P(u0, v1, z), ...P(u1, v1, z), ...P(m, v1, top)], true).fill(shade(wall, LIGHT.left));
    g.poly([...P(m, v0, top), ...P(u1, v0, z), ...P(u1, v1, z), ...P(m, v1, top)], true).fill(shade(roof, 0.72));
    g.moveTo(...P(m, v0, top)).lineTo(...P(m, v1, top)).stroke({ width: 0.8, color: shade(roof, 1.25), alpha: 0.8 });
  }
}

/** Wireframe box edges (scaffolding / survey linework). */
export function wireBox(g, u0, v0, u1, v1, z0, z1, color, width = 0.8, alpha = 1) {
  const c = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  for (let i = 0; i < 4; i++) {
    const [ua, va] = c[i];
    const [ub, vb] = c[(i + 1) % 4];
    g.moveTo(...P(ua, va, z1)).lineTo(...P(ub, vb, z1));
  }
  for (const [u, v] of [[u0, v1], [u1, v1], [u1, v0]]) g.moveTo(...P(u, v, z0)).lineTo(...P(u, v, z1));
  g.stroke({ width, color, alpha });
}
