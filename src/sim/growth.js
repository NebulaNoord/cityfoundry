// Daily growth systems: abandonment, construction, demand, spawning, occupancy.
// All iteration orders are deterministic (buildings by id, candidates by tile
// index) so that a loaded save reproduces the same future given the same RNG.

import {
  Z_R,
  Z_C,
  Z_I,
  ZONE_NAMES,
  CONSTRUCTION_DAYS,
  ABANDON_DAYS,
  MAX_SPAWN_PER_ZONE_PER_DAY,
  HIRES_PER_BUILDING_PER_DAY,
  HOUSEHOLD_SIZE,
  WORKERS_PER_HOUSEHOLD,
  R_BASE_DEMAND,
  C_JOBS_PER_RESIDENT,
  I_BASE_JOBS,
  I_JOBS_PER_RESIDENT,
  TAX_DEMAND_FACTOR,
  DEFAULT_TAX,
} from './constants.js';
import { markLandValueDirty, flushLandValue } from './landvalue.js';
import { addEmptyZoned, removeEmptyZoned } from './zoning.js';

export const STATE_NAMES = ['constructing', 'active', 'abandoned'];
export const S_CONSTRUCTING = 0;
export const S_ACTIVE = 1;
export const S_ABANDONED = 2;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Capacity of a new 1×1 level-1 building, from land value at spawn time. */
export function capacityFor(zone, landValue) {
  if (zone === Z_R) return 3 + Math.floor(landValue / 25); // households, 3..7
  if (zone === Z_C) return 4 + Math.floor(landValue / 20); // jobs, 4..9
  return 10; // industry jobs, flat
}

export function footprint(s, b, fn) {
  for (let yy = b.y; yy < b.y + b.h; yy++) {
    for (let xx = b.x; xx < b.x + b.w; xx++) fn(yy * s.width + xx);
  }
}

/** Aggregate figures used by demand, stats and finances. O(buildings). */
export function aggregates(s) {
  let households = 0;
  const jobs = { C: 0, I: 0 };
  const jobCap = { C: 0, I: 0 };
  const pendingCap = { R: 0, C: 0, I: 0 }; // active + constructing capacity
  let rCapActive = 0;
  const count = { R: 0, C: 0, I: 0 };
  for (const b of s.buildings.values()) {
    const z = ZONE_NAMES[b.zone];
    count[z]++;
    if (b.state === S_ABANDONED) continue;
    pendingCap[z] += b.capacity;
    if (b.state !== S_ACTIVE) continue;
    if (b.zone === Z_R) {
      households += b.occupants;
      rCapActive += b.capacity;
    } else {
      jobs[z] += b.occupants;
      jobCap[z] += b.capacity;
    }
  }
  const laborForce = Math.floor(households * WORKERS_PER_HOUSEHOLD);
  const workers = jobs.C + jobs.I;
  return { households, population: households * HOUSEHOLD_SIZE, laborForce, workers, jobs, jobCap, pendingCap, rCapActive, count };
}

function taxPenalty(s, z) {
  return (s.taxRates[z] - DEFAULT_TAX) * TAX_DEMAND_FACTOR[z];
}

/** Recompute R/C/I demand (-100..100) from current aggregates and taxes. */
export function computeDemand(s, agg = aggregates(s)) {
  const L = agg.laborForce;
  const jobCapAll = agg.pendingCap.C + agg.pendingCap.I;
  // R: base attraction, plus (or minus) the relative surplus of jobs over workers.
  const jobRatio = (jobCapAll - L) / Math.max(L, 50);
  const r = R_BASE_DEMAND + clamp(50 * jobRatio, -100, 50) - taxPenalty(s, 'R');
  // C: shops wanted per resident vs commercial jobs that exist or are being built.
  const cTarget = agg.population * C_JOBS_PER_RESIDENT;
  const c = (cTarget <= 0 ? 0 : clamp((100 * (cTarget - agg.pendingCap.C)) / Math.max(cTarget, 10), -100, 100)) - taxPenalty(s, 'C');
  // I: base demand plus a share of population.
  const iTarget = I_BASE_JOBS + agg.population * I_JOBS_PER_RESIDENT;
  const i = clamp((100 * (iTarget - agg.pendingCap.I)) / Math.max(iTarget, 10), -100, 100) - taxPenalty(s, 'I');
  s.demand = {
    R: Math.round(clamp(r, -100, 100)),
    C: Math.round(clamp(c, -100, 100)),
    I: Math.round(clamp(i, -100, 100)),
  };
  return s.demand;
}

function setCI(s, b, on) {
  if (b.zone === Z_R) return;
  footprint(s, b, (idx) => {
    s.ciAt[idx] = on ? b.zone : 0;
  });
  markLandValueDirty(s, b.x, b.y);
}

export function createBuilding(s, zone, x, y, capacity, tick) {
  const b = {
    id: s.nextBuildingId++,
    zone,
    level: 1,
    x,
    y,
    w: 1,
    h: 1,
    state: S_CONSTRUCTING,
    daysBuilt: 0,
    capacity,
    occupants: 0,
    builtTick: tick,
    troubleDays: 0,
  };
  s.buildings.set(b.id, b);
  footprint(s, b, (idx) => {
    removeEmptyZoned(s, idx);
    s.buildingAt[idx] = b.id;
    s.changes.markTile(idx);
  });
  setCI(s, b, true);
  s.changes.added.add(b.id);
  return b;
}

export function removeBuilding(s, b) {
  s.buildings.delete(b.id);
  if (b.state !== S_ABANDONED) setCI(s, b, false);
  footprint(s, b, (idx) => {
    s.buildingAt[idx] = 0;
    addEmptyZoned(s, idx);
    s.changes.markTile(idx);
  });
  s.changes.added.delete(b.id);
  s.changes.changed.delete(b.id);
  s.changes.removed.push(buildingSnapshot(b));
}

export function buildingSnapshot(b) {
  return {
    id: b.id,
    zone: ZONE_NAMES[b.zone],
    level: b.level,
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
    state: STATE_NAMES[b.state],
    constructionProgress: b.state === S_CONSTRUCTING ? Math.min(1, b.daysBuilt / CONSTRUCTION_DAYS) : 1,
    capacity: b.capacity,
    occupants: b.occupants,
    builtTick: b.builtTick,
  };
}

function markChanged(s, b) {
  if (!s.changes.added.has(b.id)) s.changes.changed.add(b.id);
}

function abandon(s, b) {
  setCI(s, b, false);
  b.state = S_ABANDONED;
  b.occupants = 0;
  markChanged(s, b);
  footprint(s, b, (idx) => s.changes.markTile(idx));
}

/** A building is in trouble when its tiles lost their zoning or outside connection. */
function inTrouble(s, b) {
  let trouble = false;
  footprint(s, b, (idx) => {
    if (s.zone[idx] !== b.zone || s.connCount[idx] === 0) trouble = true;
  });
  return trouble;
}

/** Abandonment + construction progress. Returns number abandoned today. */
export function dailyBuildings(s) {
  let abandoned = 0;
  for (const b of s.buildings.values()) {
    if (b.state === S_ABANDONED) continue;
    if (inTrouble(s, b)) {
      b.troubleDays++;
      if (b.troubleDays >= ABANDON_DAYS) {
        abandon(s, b);
        abandoned++;
        continue;
      }
    } else {
      b.troubleDays = 0;
    }
    if (b.state === S_CONSTRUCTING) {
      b.daysBuilt++;
      if (b.daysBuilt >= CONSTRUCTION_DAYS) b.state = S_ACTIVE;
      markChanged(s, b);
    }
  }
  return abandoned;
}

/**
 * Spawn new buildings on empty, zoned, connected tiles, weighted by land value.
 * Returns { spawned, unconnectedZoned } (the latter drives a notification).
 */
export function dailySpawn(s, agg) {
  flushLandValue(s);
  const tick = s.clock.tick;
  let spawned = 0;
  let unconnectedZoned = 0;
  let connectedZoned = 0;
  for (const z of [Z_R, Z_C, Z_I]) {
    const name = ZONE_NAMES[z];
    const set = s.emptyZoned[z];
    if (set.size === 0) continue;
    // Deterministic order regardless of Set insertion history (saves reload in index order).
    const all = Array.from(set).sort((a, b) => a - b);
    const cands = [];
    for (const idx of all) {
      if (s.connCount[idx] > 0) cands.push(idx);
      else unconnectedZoned++;
    }
    connectedZoned += cands.length;
    const demand = s.demand[name];
    if (demand <= 0 || cands.length === 0) continue;
    let n = Math.min(MAX_SPAWN_PER_ZONE_PER_DAY, Math.ceil(demand / 25), cands.length);
    // Don't over-build housing: hold R spawning while lots of housing stands empty.
    if (z === Z_R) {
      const freeR = agg.pendingCap.R - agg.households;
      if (agg.pendingCap.R >= 20 && freeR > agg.pendingCap.R * 0.5) n = 0;
    }
    if (n === 0) continue;
    const weights = new Float64Array(cands.length);
    let total = 0;
    for (let k = 0; k < cands.length; k++) {
      const lv = s.landValue[cands[k]] + 1;
      weights[k] = lv * lv;
      total += weights[k];
    }
    for (let p = 0; p < n; p++) {
      let r = s.rng.next() * total;
      let k = 0;
      while (k < cands.length - 1 && (weights[k] === 0 || r >= weights[k])) {
        r -= weights[k];
        k++;
      }
      if (weights[k] === 0) break; // all picked (floating point guard)
      const idx = cands[k];
      total -= weights[k];
      weights[k] = 0;
      const x = idx % s.width;
      const y = (idx - x) / s.width;
      createBuilding(s, z, x, y, capacityFor(z, s.landValue[idx]), tick);
      spawned++;
    }
  }
  return { spawned, unconnectedZoned, connectedZoned };
}

/** Households move in/out; residents take or lose jobs. */
export function dailyOccupancy(s) {
  const blds = Array.from(s.buildings.values()); // id order
  const demandR = s.demand.R;

  // Move-ins while R demand is positive.
  if (demandR > 0) {
    const perBuilding = 1 + Math.floor(demandR / 25);
    for (const b of blds) {
      if (b.zone !== Z_R || b.state !== S_ACTIVE || b.occupants >= b.capacity) continue;
      b.occupants += Math.min(perBuilding, b.capacity - b.occupants);
      markChanged(s, b);
    }
  } else if (demandR < -20) {
    // Strongly negative demand (heavy tax / no jobs): some households leave.
    const pLeave = Math.min(0.5, (-demandR - 20) / 100);
    for (const b of blds) {
      if (b.zone !== Z_R || b.state !== S_ACTIVE || b.occupants === 0) continue;
      if (s.rng.next() < pLeave) {
        b.occupants--;
        markChanged(s, b);
      }
    }
  }

  // Labour market.
  let households = 0;
  let workers = 0;
  for (const b of blds) {
    if (b.state !== S_ACTIVE) continue;
    if (b.zone === Z_R) households += b.occupants;
    else workers += b.occupants;
  }
  const laborForce = Math.floor(households * WORKERS_PER_HOUSEHOLD);
  if (workers > laborForce) {
    // Layoffs, newest employers first.
    let excess = workers - laborForce;
    for (let k = blds.length - 1; k >= 0 && excess > 0; k--) {
      const b = blds[k];
      if (b.zone === Z_R || b.state !== S_ACTIVE || b.occupants === 0) continue;
      const cut = Math.min(excess, b.occupants);
      b.occupants -= cut;
      excess -= cut;
      markChanged(s, b);
    }
  } else {
    // Hiring: alternate C and I so neither starves the other.
    let available = laborForce - workers;
    const employers = blds.filter((b) => b.zone !== Z_R && b.state === S_ACTIVE && b.occupants < b.capacity);
    const cList = employers.filter((b) => b.zone === Z_C);
    const iList = employers.filter((b) => b.zone === Z_I);
    const order = [];
    for (let k = 0; k < Math.max(cList.length, iList.length); k++) {
      if (k < cList.length) order.push(cList[k]);
      if (k < iList.length) order.push(iList[k]);
    }
    for (const b of order) {
      if (available <= 0) break;
      const hire = Math.min(available, HIRES_PER_BUILDING_PER_DAY, b.capacity - b.occupants);
      b.occupants += hire;
      available -= hire;
      markChanged(s, b);
    }
  }
}
