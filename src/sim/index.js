// Public simulation API (docs/API.md). Pure JS, no DOM.
//
// Every mutation (command or tick) runs as a transaction: state changes are
// recorded in a ChangeTracker, then committed — land value is flushed for
// dirty tiles, chunk versions are bumped and events are emitted — once the
// state is consistent again.

import {
  SAVE_VERSION,
  CHUNK_SIZE,
  TICKS_PER_DAY,
  TICKS_PER_MONTH,
  MAX_NOTIFICATIONS,
  R_NONE,
  R_HIGHWAY,
  Z_NONE,
  Z_R,
  ZONE_NAMES,
} from './constants.js';
import { Emitter, tilesPayload } from './events.js';
import { allocateState, generateTerrain, tileSnapshot, inBounds, isCell } from './world.js';
import { planRoad, applyRoad, removeRoad, recomputeNetwork, rebuildRoadIndex } from './roads.js';
import { planZone, applyZone, rebuildZoneIndex } from './zoning.js';
import { flushLandValue, recomputeAllLandValue } from './landvalue.js';
import {
  aggregates,
  computeDemand,
  dailyBuildings,
  dailySpawn,
  dailyOccupancy,
  removeBuilding,
  buildingSnapshot,
  S_ABANDONED,
} from './growth.js';
import { dailyFinances, checkFunds, isValidTax } from './economy.js';
import { calendar, isValidSpeed, ticksForElapsed } from './clock.js';
import { SaveError, buildSave, parseSave } from './serialize.js';
import { Rng } from './rng.js';

export { SAVE_VERSION, CHUNK_SIZE, SaveError };

const okResult = (cost, idxs, width) => ({
  ok: true,
  cost,
  changed: idxs.map((i) => ({ x: i % width, y: Math.floor(i / width) })),
});
const errResult = (error, message) => ({ ok: false, error, message });

class Simulation {
  #s;
  #em;

  constructor(state) {
    this.#s = state;
    this.#em = new Emitter();
  }

  // ---------- internals ----------

  #notify = (level, message) => {
    const s = this.#s;
    const n = { id: s.nextNotificationId++, tick: s.clock.tick, level, message };
    s.notifications.push(n);
    if (s.notifications.length > MAX_NOTIFICATIONS) s.notifications.splice(0, s.notifications.length - MAX_NOTIFICATIONS);
    s.changes.notifications.push({ id: n.id, level, message });
  };

  /** Flush derived data and emit the queued events of the current transaction. */
  #commit(extraStats = false) {
    const s = this.#s;
    flushLandValue(s);
    if (s.changes.isEmpty() && !extraStats) return;
    const batch = s.changes.take();
    const em = this.#em;
    if (batch.cells.size > 0) {
      const payload = tilesPayload(batch.cells, s.width, s.chunksX, s.chunkVersion);
      em.emit('tilesChanged', payload);
    }
    for (const id of Array.from(batch.added).sort((a, b) => a - b)) {
      const b = s.buildings.get(id);
      if (b) em.emit('buildingAdded', { building: buildingSnapshot(b) });
    }
    for (const id of Array.from(batch.changed).sort((a, b) => a - b)) {
      const b = s.buildings.get(id);
      if (b) em.emit('buildingChanged', { building: buildingSnapshot(b) });
    }
    for (const snap of batch.removed) em.emit('buildingRemoved', { building: snap });
    for (const n of batch.notifications) em.emit('notification', n);
    return batch;
  }

  #emitStats() {
    this.#em.emit('statsChanged', { stats: this.getStats() });
  }

  #runDay() {
    const s = this.#s;
    const notify = this.#notify;

    const abandoned = dailyBuildings(s);
    if (abandoned > 0) {
      notify('warn', `${abandoned} building${abandoned === 1 ? ' was' : 's were'} abandoned (no road connection or zoning).`);
    }
    let agg = aggregates(s);
    computeDemand(s, agg);
    const spawn = dailySpawn(s, agg);
    dailyOccupancy(s);
    agg = aggregates(s);
    dailyFinances(s, agg);
    checkFunds(s, notify);
    computeDemand(s, agg);

    const tick = s.clock.tick;
    if (spawn.unconnectedZoned > 0 && spawn.connectedZoned === 0 && tick - s.alerts.lastNoConnTick >= TICKS_PER_MONTH) {
      s.alerts.lastNoConnTick = tick;
      notify('warn', 'Zoned land is not connected to the outside highway, so nothing can grow. Connect your roads to the highway.');
    }
    const unemployed = agg.laborForce - agg.workers;
    if (agg.laborForce >= 30 && unemployed > agg.laborForce * 0.25 && tick - s.alerts.lastUnemploymentTick >= TICKS_PER_MONTH) {
      s.alerts.lastUnemploymentTick = tick;
      notify('warn', `High unemployment: ${unemployed} of ${agg.laborForce} workers have no job. Zone more commercial or industry.`);
    }
  }

  #advance() {
    const s = this.#s;
    s.clock.tick++;
    const tick = s.clock.tick;
    const isDay = tick % TICKS_PER_DAY === 0;
    if (isDay) this.#runDay();
    this.#em.emit('tick', { tick });
    this.#commit();
    if (isDay) {
      const { day, month, year } = calendar(tick);
      this.#em.emit('day', { day, month, year });
      this.#emitStats();
    }
  }

  // ---------- events ----------

  on(eventName, handler) {
    return this.#em.on(eventName, handler);
  }

  // ---------- time ----------

  update(dtMs) {
    const n = ticksForElapsed(this.#s.clock, dtMs);
    for (let i = 0; i < n; i++) this.#advance();
    return n;
  }

  step(n = 1) {
    if (!Number.isInteger(n) || n < 0) throw new RangeError('step(n): n must be a non-negative integer');
    for (let i = 0; i < n; i++) this.#advance();
  }

  getTime() {
    const { tick, speed } = this.#s.clock;
    return { tick, ...calendar(tick), speed };
  }

  // ---------- commands ----------

  setSpeed(n) {
    if (!isValidSpeed(n)) return errResult('INVALID', 'speed must be 0, 1, 2 or 3');
    const c = this.#s.clock;
    if (c.speed !== n) {
      c.speed = n;
      c.acc = 0;
    }
    return { ok: true, cost: 0, changed: [] };
  }

  setTaxRate(zone, pct) {
    const s = this.#s;
    if (!['R', 'C', 'I'].includes(zone)) return errResult('INVALID', "zone must be 'R', 'C' or 'I'");
    if (!isValidTax(pct)) return errResult('INVALID', 'tax rate must be an integer 0..29');
    if (s.taxRates[zone] !== pct) {
      s.taxRates[zone] = pct;
      computeDemand(s);
      this.#emitStats();
    }
    return { ok: true, cost: 0, changed: [] };
  }

  previewRoad(from, to, type = 'street') {
    const p = planRoad(this.#s, from, to, type);
    const out = { path: p.path.map((c) => ({ x: c.x, y: c.y })), cost: p.cost, valid: p.valid };
    if (!p.valid) {
      out.error = p.error;
      out.message = p.message;
    }
    return out;
  }

  placeRoad(from, to, type = 'street') {
    const s = this.#s;
    const p = planRoad(s, from, to, type);
    if (!p.valid) return errResult(p.error, p.message);
    applyRoad(s, p.build, type);
    s.fundsCents -= p.cost * 100;
    recomputeNetwork(s);
    checkFunds(s, this.#notify);
    this.#commit();
    if (p.cost > 0) this.#emitStats();
    return okResult(p.cost, p.build, s.width);
  }

  bulldoze(cells) {
    const s = this.#s;
    if (!Array.isArray(cells) || !cells.every(isCell)) return errResult('INVALID', 'cells must be an array of {x, y} integer cells');
    const targets = [];
    const seen = new Set();
    let protectedCount = 0;
    let oob = 0;
    for (const c of cells) {
      if (!inBounds(s, c.x, c.y)) {
        oob++;
        continue;
      }
      const idx = c.y * s.width + c.x;
      if (seen.has(idx)) continue;
      seen.add(idx);
      if (s.buildingAt[idx] !== 0) targets.push(idx);
      else if (s.road[idx] === R_HIGHWAY) protectedCount++;
      else if (s.road[idx] !== R_NONE || s.zone[idx] !== Z_NONE) targets.push(idx);
    }
    if (targets.length === 0 && cells.length > 0) {
      if (protectedCount > 0) return errResult('PROTECTED', 'The outside connection highway cannot be bulldozed');
      if (oob === cells.length) return errResult('OUT_OF_BOUNDS', 'All cells are outside the map');
    }
    let roadsRemoved = false;
    let buildingsRemoved = false;
    const changed = [];
    for (const idx of targets) {
      const bid = s.buildingAt[idx];
      if (bid !== 0) {
        const b = s.buildings.get(bid);
        if (!b) continue; // already removed via another footprint tile
        removeBuilding(s, b);
        buildingsRemoved = true;
        changed.push(idx);
      } else if (s.road[idx] !== R_NONE) {
        if (removeRoad(s, idx)) {
          roadsRemoved = true;
          changed.push(idx);
        }
      } else if (s.zone[idx] !== Z_NONE) {
        applyZone(s, [idx], Z_NONE);
        changed.push(idx);
      }
    }
    if (roadsRemoved) recomputeNetwork(s);
    this.#commit();
    if (roadsRemoved || buildingsRemoved) {
      computeDemand(s);
      this.#emitStats();
    }
    return okResult(0, changed, s.width);
  }

  paintZone(cells, zone) {
    const s = this.#s;
    const p = planZone(s, cells, zone);
    if (p.error) return errResult(p.error, p.message);
    applyZone(s, p.targets, p.zoneCode);
    this.#commit();
    return okResult(0, p.targets, s.width);
  }

  // ---------- queries ----------

  getWorld() {
    const s = this.#s;
    return {
      width: s.width,
      height: s.height,
      chunkSize: CHUNK_SIZE,
      name: s.name,
      seed: s.seed,
      outsideConnection: { x: s.outside.x, y: s.outside.y },
    };
  }

  getTile(x, y) {
    const s = this.#s;
    if (!Number.isInteger(x) || !Number.isInteger(y) || !inBounds(s, x, y)) return null;
    return tileSnapshot(s, y * s.width + x);
  }

  getTilesInRect(x0, y0, x1, y1) {
    const s = this.#s;
    if (![x0, y0, x1, y1].every(Number.isFinite)) return [];
    const ax = Math.max(0, Math.floor(Math.min(x0, x1)));
    const bx = Math.min(s.width - 1, Math.floor(Math.max(x0, x1)));
    const ay = Math.max(0, Math.floor(Math.min(y0, y1)));
    const by = Math.min(s.height - 1, Math.floor(Math.max(y0, y1)));
    const out = [];
    for (let y = ay; y <= by; y++) {
      for (let x = ax; x <= bx; x++) out.push(tileSnapshot(s, y * s.width + x));
    }
    return out;
  }

  getChunkVersion(cx, cy) {
    const s = this.#s;
    if (!Number.isInteger(cx) || !Number.isInteger(cy) || cx < 0 || cy < 0 || cx >= s.chunksX || cy >= s.chunksY) return null;
    return s.chunkVersion[cy * s.chunksX + cx];
  }

  getBuilding(id) {
    const b = this.#s.buildings.get(id);
    return b ? buildingSnapshot(b) : null;
  }

  getBuildings() {
    return Array.from(this.#s.buildings.values(), buildingSnapshot);
  }

  getStats() {
    const s = this.#s;
    const a = aggregates(s);
    const live = { R: 0, C: 0, I: 0 };
    for (const b of s.buildings.values()) if (b.state !== S_ABANDONED) live[ZONE_NAMES[b.zone]]++;
    const income = s.lastDaily.incomeCents / 100;
    const expenses = s.lastDaily.expensesCents / 100;
    return {
      population: a.population,
      households: a.households,
      jobs: { C: a.jobs.C, I: a.jobs.I, total: a.jobs.C + a.jobs.I },
      jobCapacity: { C: a.jobCap.C, I: a.jobCap.I, total: a.jobCap.C + a.jobCap.I },
      workers: a.workers,
      unemployed: a.laborForce - a.workers,
      funds: s.fundsCents / 100,
      daily: { income, expenses, net: (s.lastDaily.incomeCents - s.lastDaily.expensesCents) / 100 },
      taxRates: { ...s.taxRates },
      demand: { ...s.demand },
      buildings: { R: a.count.R, C: a.count.C, I: a.count.I, total: a.count.R + a.count.C + a.count.I },
    };
  }

  getRoadNetwork() {
    const s = this.#s;
    return { tiles: s.roadTiles.size, components: s.network.components, connectedTiles: s.network.connectedTiles };
  }

  getNotifications(limit = 20) {
    const list = this.#s.notifications;
    const n = Number.isInteger(limit) && limit >= 0 ? limit : 20;
    const out = [];
    for (let i = list.length - 1; i >= 0 && out.length < n; i--) {
      const { id, tick, level, message } = list[i];
      out.push({ id, tick, level, message });
    }
    return out;
  }

  // ---------- persistence ----------

  serialize() {
    return buildSave(this.#s);
  }
}

/** Finish deriving per-tile indices after the persistent arrays are filled. */
function deriveIndices(s) {
  rebuildRoadIndex(s);
  rebuildZoneIndex(s);
}

export function createSimulation({ width = 128, height = 128, seed = Date.now(), name = 'New City' } = {}) {
  if (!(typeof seed === 'number' && Number.isFinite(seed)) && typeof seed !== 'string') {
    throw new TypeError('seed must be a finite number or a string');
  }
  const s = allocateState({ width, height, seed, name });
  generateTerrain(s);
  deriveIndices(s);
  recomputeAllLandValue(s);
  computeDemand(s);
  s.changes.reset();
  return new Simulation(s);
}

export function loadSimulation(saveData) {
  let data = saveData;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      throw new SaveError('Save data is not valid JSON');
    }
  }
  const d = parseSave(data);
  const s = allocateState({ width: d.width, height: d.height, seed: d.seed, name: d.name });
  s.terrain.set(d.terrain);
  s.road.set(d.road);
  s.zone.set(d.zone);
  s.landValue.set(d.landValue);
  s.chunkVersion.set(d.chunkVersion);
  for (const b of d.buildings) {
    s.buildings.set(b.id, { ...b });
    for (let yy = b.y; yy < b.y + b.h; yy++) {
      for (let xx = b.x; xx < b.x + b.w; xx++) {
        const idx = yy * s.width + xx;
        s.buildingAt[idx] = b.id;
        if (b.state !== S_ABANDONED && b.zone !== Z_R) s.ciAt[idx] = b.zone;
      }
    }
  }
  deriveIndices(s);
  // rebuildRoadIndex marks land value dirty around every road; the saved field
  // is authoritative, so drop that and restore exactly the saved dirty list.
  s.lvDirtyFlag.fill(0);
  s.lvDirty = [];
  for (const i of d.lvDirty) {
    if (!s.lvDirtyFlag[i]) {
      s.lvDirtyFlag[i] = 1;
      s.lvDirty.push(i);
    }
  }
  s.clock.tick = d.tick;
  s.clock.speed = d.speed;
  s.rng = new Rng(d.rng);
  s.fundsCents = d.fundsCents;
  s.taxRates = d.taxRates;
  s.demand = d.demand;
  s.lastDaily = d.lastDaily;
  s.alerts = d.alerts;
  s.nextBuildingId = d.nextBuildingId;
  s.nextNotificationId = d.nextNotificationId;
  s.notifications = d.notifications;
  s.changes.reset();
  return new Simulation(s);
}
