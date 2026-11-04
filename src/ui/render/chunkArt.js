// Builds the display content of one map chunk from sim tile snapshots.
// Pure drawing: given tiles (with a 1-tile border) and buildings, fills the
// provided Graphics objects. No sim calls in here.
import { P, rectPoly, shade, mix, hash2 } from './draw.js';
import { roadMask, roadPiece, N, E, S, W } from './roadPieces.js';
import { drawLot, drawBuilding } from './buildings.js';
import { WORLD, ZONE } from './palette.js';

export const ROAD_HALF = { street: 0.3, avenue: 0.42, highway: 0.44 };
const CURB = 0.07;

/** Tile lookup over a fetched rect. */
export function makeTileGrid(tiles, x0, y0, x1, y1) {
  const w = x1 - x0 + 1;
  const arr = new Array(w * (y1 - y0 + 1)).fill(null);
  for (const t of tiles) arr[(t.y - y0) * w + (t.x - x0)] = t;
  return (x, y) => (x < x0 || x > x1 || y < y0 || y > y1 ? null : arr[(y - y0) * w + (x - x0)]);
}

// ------------------------------------------------------------------ terrain
export function drawTerrain(g, at, x0, y0, x1, y1) {
  // one base slab of grass for the whole chunk, then per-tile variation
  g.poly(rectPoly(x0, y0, x1 + 1, y1 + 1), true).fill(WORLD.grass[0]);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = at(x, y);
      if (!t) continue;
      if (t.terrain === 'water') {
        drawWater(g, at, x, y);
        continue;
      }
      const r = hash2(x, y, 1);
      if (r > 0.45) {
        const c = WORLD.grass[1 + Math.floor(hash2(x, y, 2) * (WORLD.grass.length - 1))];
        g.poly(rectPoly(x, y, x + 1, y + 1), true).fill(c);
      }
      if (hash2(x, y, 5) > 0.72) {
        // tufts / mown stripes: little strokes that read as texture at zoom
        const u = x + 0.2 + hash2(x, y, 6) * 0.6;
        const v = y + 0.2 + hash2(x, y, 7) * 0.6;
        g.poly([...P(u - 0.08, v), ...P(u, v - 0.05), ...P(u + 0.08, v), ...P(u, v + 0.05)], true)
          .fill({ color: hash2(x, y, 8) > 0.5 ? WORLD.grassSpeck : WORLD.grassLight, alpha: 0.7 });
      }
    }
  }
}

function isLand(t) {
  return t && t.terrain !== 'water';
}

function drawWater(g, at, x, y) {
  const deep = !isLand(at(x, y - 1)) && !isLand(at(x + 1, y)) && !isLand(at(x, y + 1)) && !isLand(at(x - 1, y));
  g.poly(rectPoly(x, y, x + 1, y + 1), true).fill(deep ? WORLD.waterDeep : WORLD.water);
  const bw = 0.13, sw = 0.12;
  const edges = [
    [at(x, y - 1), (d) => [x, y, x + 1, y + d]],
    [at(x + 1, y), (d) => [x + 1 - d, y, x + 1, y + 1]],
    [at(x, y + 1), (d) => [x, y + 1 - d, x + 1, y + 1]],
    [at(x - 1, y), (d) => [x, y, x + d, y + 1]],
  ];
  for (const [n, rect] of edges) {
    if (!isLand(n)) continue;
    const [a, b, c, d] = rect(bw + sw);
    g.poly(rectPoly(a, b, c, d), true).fill({ color: mix(WORLD.water, WORLD.waterGlint, 0.25), alpha: 0.9 });
  }
  for (const [n, rect] of edges) {
    if (!isLand(n)) continue;
    const [a, b, c, d] = rect(bw);
    g.poly(rectPoly(a, b, c, d), true).fill(WORLD.bank);
  }
  if (hash2(x, y, 9) > 0.7) {
    const u = x + 0.3 + hash2(x, y, 10) * 0.4, v = y + 0.3 + hash2(x, y, 11) * 0.4;
    g.moveTo(...P(u - 0.12, v + 0.12)).lineTo(...P(u + 0.12, v - 0.12)).stroke({ width: 1, color: WORLD.waterGlint, alpha: 0.35 });
  }
}

// -------------------------------------------------------------------- roads
function armRect(x, y, bit, hw, reach = 0.5) {
  const cu = x + 0.5, cv = y + 0.5;
  switch (bit) {
    case N: return [cu - hw, cv - reach, cu + hw, cv];
    case S: return [cu - hw, cv, cu + hw, cv + reach];
    case E: return [cu, cv - hw, cu + reach, cv + hw];
    default: return [cu - reach, cv - hw, cu, cv + hw];
  }
}

function roadShape(g, x, y, arms, hw, color) {
  const cu = x + 0.5, cv = y + 0.5;
  g.poly(rectPoly(cu - hw, cv - hw, cu + hw, cv + hw), true).fill(color);
  for (const bit of arms) {
    const [a, b, c, d] = armRect(x, y, bit, hw);
    g.poly(rectPoly(a, b, c, d), true).fill(color);
  }
}

/** Line along an arm from distance `from` to `to` from the tile centre, offset sideways by `off`. */
function armLine(x, y, bit, from, to, off = 0) {
  const cu = x + 0.5, cv = y + 0.5;
  switch (bit) {
    case N: return [P(cu + off, cv - from), P(cu + off, cv - to)];
    case S: return [P(cu + off, cv + from), P(cu + off, cv + to)];
    case E: return [P(cu + from, cv + off), P(cu + to, cv + off)];
    default: return [P(cu - from, cv + off), P(cu - to, cv + off)];
  }
}

function dashed(g, x, y, bit, from, to, off, dash = 0.14, gap = 0.1) {
  for (let s = from; s < to - 0.01; s += dash + gap) {
    const [a, b] = armLine(x, y, bit, s, Math.min(to, s + dash), off);
    g.moveTo(a[0], a[1]).lineTo(b[0], b[1]);
  }
}

function solid(g, x, y, bit, from, to, off) {
  const [a, b] = armLine(x, y, bit, from, to, off);
  g.moveTo(a[0], a[1]).lineTo(b[0], b[1]);
}

/** Crosswalk zebra across an arm, just outside the junction core. */
function zebra(g, x, y, bit, hw) {
  const stripes = 5;
  for (let k = 0; k < stripes; k++) {
    const off = -hw + 0.06 + ((2 * hw - 0.12) * k) / (stripes - 1);
    const [a, b] = armLine(x, y, bit, hw + 0.02, hw + 0.12, off);
    g.moveTo(a[0], a[1]).lineTo(b[0], b[1]);
  }
}

export function drawRoads(g, at, x0, y0, x1, y1) {
  const hasRoad = (x, y) => !!(at(x, y) && at(x, y).road);
  // pass 1: curbs / sidewalks (so neighbouring asphalt overlaps them cleanly)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = at(x, y);
      if (!t || !t.road) continue;
      const piece = roadPiece(roadMask(x, y, hasRoad));
      const type = t.road.type;
      const hw = ROAD_HALF[type] ?? ROAD_HALF.street;
      roadShape(g, x, y, piece.arms, hw + (type === 'highway' ? 0.04 : CURB), type === 'highway' ? 0x6e6c62 : WORLD.curb);
    }
  }
  // pass 2: asphalt and markings
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = at(x, y);
      if (!t || !t.road) continue;
      const type = t.road.type;
      const piece = roadPiece(roadMask(x, y, hasRoad));
      const hw = ROAD_HALF[type] ?? ROAD_HALF.street;
      const asphalt = type === 'highway' ? WORLD.asphaltHighway : type === 'avenue' ? WORLD.asphaltAvenue : WORLD.asphalt;
      roadShape(g, x, y, piece.arms, hw, shade(asphalt, 0.97 + hash2(x, y, 12) * 0.06));
      drawMarkings(g, x, y, type, piece, hw);
    }
  }
}

function drawMarkings(g, x, y, type, piece, hw) {
  const junction = piece.kind === 'tee' || piece.kind === 'cross';
  const start = junction ? hw + 0.14 : 0;
  if (type === 'highway') {
    for (const bit of piece.arms) {
      solid(g, x, y, bit, junction ? hw : 0, 0.5, hw - 0.05);
      solid(g, x, y, bit, junction ? hw : 0, 0.5, -(hw - 0.05));
    }
    g.stroke({ width: 1.2, color: WORLD.laneYellow, alpha: 0.85 });
    for (const bit of piece.arms) dashed(g, x, y, bit, start, 0.5, 0, 0.18, 0.12);
    g.stroke({ width: 1, color: WORLD.lane, alpha: 0.75 });
    return;
  }
  if (type === 'avenue') {
    // planted median on through-segments
    for (const bit of piece.arms) {
      const from = junction ? hw + 0.14 : piece.kind === 'deadend' ? 0.1 : 0;
      const [a, b, c, d] = medianRect(x, y, bit, from, 0.5, 0.06);
      g.poly(rectPoly(a, b, c, d), true).fill(WORLD.curb);
      const [a2, b2, c2, d2] = medianRect(x, y, bit, from + 0.02, 0.5, 0.04);
      g.poly(rectPoly(a2, b2, c2, d2), true).fill(WORLD.median);
    }
    if (piece.kind === 'corner' || piece.kind === 'straight') {
      // join medians in the core
      g.poly(rectPoly(x + 0.44, y + 0.44, x + 0.56, y + 0.56), true).fill(WORLD.median);
    }
    for (const bit of piece.arms) {
      dashed(g, x, y, bit, start, 0.5, hw * 0.55);
      dashed(g, x, y, bit, start, 0.5, -hw * 0.55);
    }
    g.stroke({ width: 0.8, color: WORLD.lane, alpha: 0.6 });
  } else {
    if (!junction) {
      for (const bit of piece.arms) dashed(g, x, y, bit, piece.kind === 'deadend' ? 0.12 : 0, 0.5, 0);
      g.stroke({ width: 0.9, color: WORLD.laneYellow, alpha: 0.75 });
    }
  }
  if (junction) {
    for (const bit of piece.arms) zebra(g, x, y, bit, hw);
    g.stroke({ width: 1.6, color: WORLD.lane, alpha: 0.55 });
  }
}

function medianRect(x, y, bit, from, to, half) {
  const cu = x + 0.5, cv = y + 0.5;
  switch (bit) {
    case N: return [cu - half, cv - to, cu + half, cv - from];
    case S: return [cu - half, cv + from, cu + half, cv + to];
    case E: return [cu + from, cv - half, cu + to, cv + half];
    default: return [cu - to, cv - half, cu - from, cv + half];
  }
}

// ---------------------------------------------------------------- zoning
export function drawZones(g, at, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = at(x, y);
      if (!t || !t.zone || t.buildingId != null) continue;
      const c = ZONE[t.zone];
      g.poly(rectPoly(x, y, x + 1, y + 1), true).fill({ color: c, alpha: t.connected ? 0.3 : 0.14 });
      g.poly(rectPoly(x + 0.08, y + 0.08, x + 0.92, y + 0.92), true).stroke({ width: 1, color: c, alpha: t.connected ? 0.85 : 0.5 });
      if (!t.connected) {
        // hatched: zoned, but its roads don't reach the highway yet
        g.moveTo(...P(x + 0.2, y + 0.8)).lineTo(...P(x + 0.8, y + 0.2));
        g.moveTo(...P(x + 0.5, y + 0.8)).lineTo(...P(x + 0.8, y + 0.5));
        g.moveTo(...P(x + 0.2, y + 0.5)).lineTo(...P(x + 0.5, y + 0.2));
        g.stroke({ width: 1, color: c, alpha: 0.6 });
      }
    }
  }
}

// ------------------------------------------------- lots, buildings, shadows
export function drawBuildings(groundG, shadowG, objG, at, x0, y0, x1, y1, getBuilding) {
  const list = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = at(x, y);
      if (!t || t.buildingId == null) continue;
      const b = getBuilding(t.buildingId);
      if (!b) continue;
      drawLot(groundG, b, x, y);
      if (b.x === x && b.y === y) list.push(b);
    }
  }
  list.sort((a, b) => a.x + a.y - (b.x + b.y) || a.x - b.x);
  for (const b of list) drawBuilding(objG, shadowG, b);
  return list.length;
}

// ------------------------------------------------- road-access overlay (zone tools)
export function drawAccess(g, at, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = at(x, y);
      if (!t || t.terrain === 'water' || t.road || t.roadAccess) continue;
      g.poly(rectPoly(x, y, x + 1, y + 1), true).fill({ color: 0x1b2125, alpha: 0.38 });
    }
  }
}
