// Road placement, removal, network components and outside connectivity.
//
// Per-tile counters kept up to date incrementally:
//   accessCount[i] = number of road tiles within Chebyshev distance ZONE_DEPTH
//   connCount[i]   = number of *connected* road tiles within that window
// so `roadAccess` and `connected` for any tile are O(1). A road change costs
// one 9×9 window update per changed road tile, plus one BFS over the road
// graph (O(road tiles)) to refresh component count and connectivity.

import {
  ZONE_DEPTH,
  T_WATER,
  R_NONE,
  R_HIGHWAY,
  ROAD_CODE,
  ROAD_COST,
  ROAD_UPKEEP_CENTS,
  Z_NONE,
} from './constants.js';
import { inBounds, isCell } from './world.js';
import { markLandValueDirty } from './landvalue.js';
import { removeEmptyZoned } from './zoning.js';

/** Call fn(idx) for every in-bounds tile within Chebyshev distance r of (x, y). */
export function forWindow(s, x, y, r, fn) {
  const x0 = Math.max(0, x - r);
  const x1 = Math.min(s.width - 1, x + r);
  const y0 = Math.max(0, y - r);
  const y1 = Math.min(s.height - 1, y + r);
  for (let yy = y0; yy <= y1; yy++) {
    const row = yy * s.width;
    for (let xx = x0; xx <= x1; xx++) fn(row + xx);
  }
}

function adjustAccess(s, idx, delta) {
  const x = idx % s.width;
  const y = (idx - x) / s.width;
  const { accessCount, changes } = s;
  forWindow(s, x, y, ZONE_DEPTH, (j) => {
    const before = accessCount[j];
    accessCount[j] = before + delta;
    if ((before === 0) !== (accessCount[j] === 0)) changes.markTile(j);
  });
  markLandValueDirty(s, x, y);
}

function adjustConn(s, idx, delta) {
  const x = idx % s.width;
  const y = (idx - x) / s.width;
  const { connCount, changes } = s;
  forWindow(s, x, y, ZONE_DEPTH, (j) => {
    const before = connCount[j];
    connCount[j] = before + delta;
    if ((before === 0) !== (connCount[j] === 0)) changes.markTile(j);
  });
}

/** Straight or L-shaped (horizontal first) path. Assumes valid cells. */
export function roadPath(from, to) {
  const path = [];
  const sx = Math.sign(to.x - from.x);
  const sy = Math.sign(to.y - from.y);
  let x = from.x;
  const y0 = from.y;
  path.push({ x, y: y0 });
  while (x !== to.x) {
    x += sx;
    path.push({ x, y: y0 });
  }
  let y = y0;
  while (y !== to.y) {
    y += sy;
    path.push({ x, y });
  }
  return path;
}

/**
 * Pure planning step shared by previewRoad and placeRoad.
 * Returns { path, cost (dollars), valid, error?, message?, build: [idx] }.
 */
export function planRoad(s, from, to, type = 'street') {
  if (!isCell(from) || !isCell(to)) {
    return { path: [], cost: 0, valid: false, error: 'INVALID', message: 'from/to must be {x, y} integer cells', build: [] };
  }
  if (type === 'highway' || !Object.prototype.hasOwnProperty.call(ROAD_COST, type)) {
    return { path: [], cost: 0, valid: false, error: 'INVALID', message: `Unknown or non-buildable road type "${type}"`, build: [] };
  }
  const path = roadPath(from, to);
  const code = ROAD_CODE[type];
  const fail = (error, message) => ({ path, cost, valid: false, error, message, build: [] });
  let cost = 0;
  const build = [];
  for (const c of path) {
    if (!inBounds(s, c.x, c.y)) return fail('OUT_OF_BOUNDS', `Tile (${c.x}, ${c.y}) is outside the map`);
  }
  for (const c of path) {
    const idx = c.y * s.width + c.x;
    if (s.terrain[idx] === T_WATER) return fail('WATER', `Tile (${c.x}, ${c.y}) is water`);
    if (s.buildingAt[idx] !== 0) return fail('BLOCKED', `Tile (${c.x}, ${c.y}) has a building`);
    const r = s.road[idx];
    if (r === R_HIGHWAY || r === code) continue; // free, left as is
    cost += ROAD_COST[type];
    build.push(idx);
  }
  if (cost * 100 > s.fundsCents) {
    return fail('INSUFFICIENT_FUNDS', `Road costs $${cost}, you have $${s.fundsCents / 100}`);
  }
  return { path, cost, valid: true, build };
}

/** Apply a validated plan. Mutates state; caller recomputes the network. */
export function applyRoad(s, build, type) {
  const code = ROAD_CODE[type];
  for (const idx of build) {
    const prev = s.road[idx];
    if (prev === R_NONE) {
      s.roadTiles.add(idx);
      adjustAccess(s, idx, +1);
    } else {
      s.upkeepCents -= ROAD_UPKEEP_CENTS[prev];
    }
    s.road[idx] = code;
    s.upkeepCents += ROAD_UPKEEP_CENTS[code];
    if (s.zone[idx] !== Z_NONE) {
      removeEmptyZoned(s, idx);
      s.zone[idx] = Z_NONE;
    }
    s.changes.markTile(idx);
  }
}

/** Remove a non-highway road tile. Caller recomputes the network. */
export function removeRoad(s, idx) {
  const r = s.road[idx];
  if (r === R_NONE || r === R_HIGHWAY) return false;
  if (s.roadConnected[idx]) {
    s.roadConnected[idx] = 0;
    adjustConn(s, idx, -1);
  }
  adjustAccess(s, idx, -1);
  s.road[idx] = R_NONE;
  s.roadTiles.delete(idx);
  s.upkeepCents -= ROAD_UPKEEP_CENTS[r];
  s.changes.markTile(idx);
  return true;
}

function nextStamp(s) {
  if (s.visitStamp >= 0xfffffff0) {
    s.visit.fill(0);
    s.visitStamp = 0;
  }
  return ++s.visitStamp;
}

function bfs(s, start, stamp, queue) {
  const { width, height, road, visit } = s;
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  visit[start] = stamp;
  let count = 0;
  while (head < tail) {
    const i = queue[head++];
    count++;
    const x = i % width;
    if (x > 0 && road[i - 1] !== R_NONE && visit[i - 1] !== stamp) { visit[i - 1] = stamp; queue[tail++] = i - 1; }
    if (x < width - 1 && road[i + 1] !== R_NONE && visit[i + 1] !== stamp) { visit[i + 1] = stamp; queue[tail++] = i + 1; }
    if (i >= width && road[i - width] !== R_NONE && visit[i - width] !== stamp) { visit[i - width] = stamp; queue[tail++] = i - width; }
    if (i < (height - 1) * width && road[i + width] !== R_NONE && visit[i + width] !== stamp) { visit[i + width] = stamp; queue[tail++] = i + width; }
  }
  return count;
}

/**
 * Recompute connectivity (from the outside connection) and component count.
 * O(road tiles) plus a window update for each tile whose connectivity flipped.
 */
export function recomputeNetwork(s) {
  const queue = new Int32Array(Math.max(1, s.roadTiles.size));
  const stamp = nextStamp(s);
  let connectedTiles = 0;
  if (s.road[s.outsideIdx] !== R_NONE) connectedTiles = bfs(s, s.outsideIdx, stamp, queue);
  for (const idx of s.roadTiles) {
    const now = s.visit[idx] === stamp ? 1 : 0;
    if (now !== s.roadConnected[idx]) {
      s.roadConnected[idx] = now;
      adjustConn(s, idx, now ? +1 : -1);
    }
  }
  let components = connectedTiles > 0 ? 1 : 0;
  for (const idx of s.roadTiles) {
    if (s.visit[idx] !== stamp) {
      bfs(s, idx, stamp, queue);
      components++;
    }
  }
  s.network = { components, connectedTiles };
}

/** Rebuild all road-derived fields from s.road (used on create/load). */
export function rebuildRoadIndex(s) {
  s.roadTiles.clear();
  s.accessCount.fill(0);
  s.connCount.fill(0);
  s.roadConnected.fill(0);
  s.upkeepCents = 0;
  for (let idx = 0; idx < s.size; idx++) {
    const r = s.road[idx];
    if (r === R_NONE) continue;
    s.roadTiles.add(idx);
    s.upkeepCents += ROAD_UPKEEP_CENTS[r];
    adjustAccess(s, idx, +1);
  }
  recomputeNetwork(s);
}
