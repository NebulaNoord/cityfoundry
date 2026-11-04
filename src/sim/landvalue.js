// Land value field (0..100), recomputed only for dirty tiles.
// A tile's value depends on roads and live C/I buildings within LV_RADIUS,
// so any road or C/I change marks the surrounding window dirty.

import {
  LV_BASE,
  LV_ROAD_NEAR,
  LV_ROAD_FAR,
  LV_PER_C,
  LV_MAX_C,
  LV_PER_I,
  LV_MAX_I,
  LV_RADIUS,
  T_WATER,
  R_NONE,
  Z_C,
  Z_I,
} from './constants.js';

export function markLandValueDirty(s, x, y) {
  const x0 = Math.max(0, x - LV_RADIUS);
  const x1 = Math.min(s.width - 1, x + LV_RADIUS);
  const y0 = Math.max(0, y - LV_RADIUS);
  const y1 = Math.min(s.height - 1, y + LV_RADIUS);
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const j = yy * s.width + xx;
      if (!s.lvDirtyFlag[j]) {
        s.lvDirtyFlag[j] = 1;
        s.lvDirty.push(j);
      }
    }
  }
}

export function computeLandValue(s, idx) {
  if (s.terrain[idx] === T_WATER) return 0;
  const x = idx % s.width;
  const y = (idx - x) / s.width;
  const x0 = Math.max(0, x - LV_RADIUS);
  const x1 = Math.min(s.width - 1, x + LV_RADIUS);
  const y0 = Math.max(0, y - LV_RADIUS);
  const y1 = Math.min(s.height - 1, y + LV_RADIUS);
  let nearestRoad = 99;
  let c = 0;
  let ind = 0;
  for (let yy = y0; yy <= y1; yy++) {
    const row = yy * s.width;
    const dy = Math.abs(yy - y);
    for (let xx = x0; xx <= x1; xx++) {
      const j = row + xx;
      if (s.road[j] !== R_NONE) {
        const d = Math.max(dy, Math.abs(xx - x));
        if (d < nearestRoad) nearestRoad = d;
      }
      const ci = s.ciAt[j];
      if (ci === Z_C) c++;
      else if (ci === Z_I) ind++;
    }
  }
  let v = LV_BASE;
  if (nearestRoad <= 2) v += LV_ROAD_NEAR;
  else if (nearestRoad <= LV_RADIUS) v += LV_ROAD_FAR;
  v += Math.min(LV_MAX_C, c * LV_PER_C);
  v -= Math.min(LV_MAX_I, ind * LV_PER_I);
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

/** Recompute all dirty tiles; marks tiles whose value changed. */
export function flushLandValue(s) {
  const dirty = s.lvDirty;
  if (dirty.length === 0) return 0;
  for (let k = 0; k < dirty.length; k++) {
    const idx = dirty[k];
    s.lvDirtyFlag[idx] = 0;
    const v = computeLandValue(s, idx);
    if (v !== s.landValue[idx]) {
      s.landValue[idx] = v;
      s.changes.markTile(idx);
    }
  }
  const n = dirty.length;
  s.lvDirty = [];
  return n;
}

/** Full recompute without change marking (create / load). */
export function recomputeAllLandValue(s) {
  s.lvDirtyFlag.fill(0);
  s.lvDirty = [];
  for (let idx = 0; idx < s.size; idx++) s.landValue[idx] = computeLandValue(s, idx);
}
