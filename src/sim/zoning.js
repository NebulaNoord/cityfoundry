// Zone painting and the "empty zoned tile" candidate sets used by spawning.
// Invariant: idx ∈ s.emptyZoned[z]  ⇔  s.zone[idx] === z && s.buildingAt[idx] === 0.

import { T_WATER, R_NONE, Z_NONE, ZONE_CODE } from './constants.js';
import { inBounds, isCell } from './world.js';

export function addEmptyZoned(s, idx) {
  const z = s.zone[idx];
  if (z !== Z_NONE && s.buildingAt[idx] === 0) s.emptyZoned[z].add(idx);
}

export function removeEmptyZoned(s, idx) {
  const z = s.zone[idx];
  if (z !== Z_NONE) s.emptyZoned[z].delete(idx);
}

export function rebuildZoneIndex(s) {
  for (let z = 1; z <= 3; z++) s.emptyZoned[z].clear();
  for (let idx = 0; idx < s.size; idx++) addEmptyZoned(s, idx);
}

/**
 * Validate a paintZone request without mutating.
 * Returns { error, message } or { targets: [idx], zoneCode }.
 */
export function planZone(s, cells, zone) {
  if (!Array.isArray(cells) || !cells.every(isCell)) {
    return { error: 'INVALID', message: 'cells must be an array of {x, y} integer cells' };
  }
  if (zone !== null && !Object.prototype.hasOwnProperty.call(ZONE_CODE, zone)) {
    return { error: 'INVALID', message: `zone must be 'R', 'C', 'I' or null, got ${JSON.stringify(zone)}` };
  }
  const code = zone === null ? Z_NONE : ZONE_CODE[zone];
  const targets = [];
  const seen = new Set();
  let noAccess = 0;
  let outOfBounds = 0;
  for (const c of cells) {
    if (!inBounds(s, c.x, c.y)) {
      outOfBounds++;
      continue;
    }
    const idx = c.y * s.width + c.x;
    if (seen.has(idx)) continue;
    seen.add(idx);
    if (s.zone[idx] === code) continue;
    if (code !== Z_NONE) {
      if (s.terrain[idx] === T_WATER || s.road[idx] !== R_NONE) continue;
      if (s.accessCount[idx] === 0) {
        noAccess++;
        continue;
      }
    }
    targets.push(idx);
  }
  if (targets.length === 0 && cells.length > 0) {
    if (noAccess > 0) return { error: 'NO_ROAD_ACCESS', message: `No road within ${4} tiles of the painted area` };
    if (outOfBounds === cells.length) return { error: 'OUT_OF_BOUNDS', message: 'All cells are outside the map' };
  }
  return { targets, zoneCode: code };
}

/** Apply a validated zone plan. Returns the list of changed tile indices. */
export function applyZone(s, targets, code) {
  for (const idx of targets) {
    removeEmptyZoned(s, idx);
    s.zone[idx] = code;
    addEmptyZoned(s, idx);
    s.changes.markTile(idx);
  }
  return targets;
}
