import { describe, it, expect } from 'vitest';
import { createSimulation, loadSimulation, SaveError, SAVE_VERSION } from '../../src/sim/index.js';
import { DAY, allTiles, buildTown } from './helpers.js';

function snapshot(sim) {
  return {
    time: sim.getTime(),
    stats: sim.getStats(),
    tiles: allTiles(sim),
    buildings: sim.getBuildings(),
    net: sim.getRoadNetwork(),
    notes: sim.getNotifications(200),
  };
}

describe('serialize / loadSimulation', () => {
  it('round trip reproduces stats, tiles, buildings and chunk versions', () => {
    const { sim } = buildTown();
    sim.setTaxRate('C', 12);
    sim.step(35 * DAY + 7); // mid-day save
    const data = sim.serialize();
    expect(data.version).toBe(SAVE_VERSION);
    // JSON-safe: survives a string round trip unchanged.
    const json = JSON.stringify(data);
    expect(JSON.parse(json)).toEqual(data);
    const loaded = loadSimulation(JSON.parse(json));
    expect(snapshot(loaded)).toEqual(snapshot(sim));
    expect(loaded.getWorld()).toEqual(sim.getWorld());
    for (let cy = 0; cy < 8; cy++) for (let cx = 0; cx < 8; cx++) expect(loaded.getChunkVersion(cx, cy)).toBe(sim.getChunkVersion(cx, cy));
    // Accepts the JSON string form too.
    expect(snapshot(loadSimulation(json))).toEqual(snapshot(sim));
  });

  it('a loaded city has an identical future (RNG state saved)', () => {
    const { sim, y } = buildTown();
    sim.step(20 * DAY);
    const loaded = loadSimulation(sim.serialize());
    // Same commands on both.
    for (const s of [sim, loaded]) {
      s.placeRoad({ x: 30, y: y + 1 }, { x: 30, y: y + 12 });
      s.setTaxRate('R', 7);
    }
    sim.step(40 * DAY);
    loaded.step(40 * DAY);
    expect(snapshot(loaded)).toEqual(snapshot(sim));
    expect(sim.getStats().population).toBeGreaterThan(0);
  });

  it('two sims from the same seed and commands are identical (determinism)', () => {
    const a = buildTown().sim;
    const b = buildTown().sim;
    a.step(50 * DAY);
    b.step(50 * DAY);
    expect(snapshot(a)).toEqual(snapshot(b));
    expect(JSON.stringify(a.serialize())).toBe(JSON.stringify(b.serialize()));
  });

  it('a fresh 128×128 save is small', () => {
    const json = JSON.stringify(createSimulation({ seed: 3 }).serialize());
    expect(json.length).toBeLessThan(20000);
  });
});

describe('SaveError on bad data', () => {
  let cached = null;
  const good = () => {
    if (!cached) {
      const { sim } = buildTown();
      sim.step(10 * DAY);
      cached = JSON.stringify(sim.serialize());
    }
    const d = JSON.parse(cached);
    if (d.buildings.length === 0) throw new Error('fixture needs buildings');
    return d;
  };

  const cases = [
    ['null', () => null],
    ['array', () => []],
    ['number', () => 42],
    ['invalid JSON string', () => '{"format":'],
    ['foreign object', () => ({ hello: 'world' })],
    ['missing version', () => { const d = good(); delete d.version; return d; }],
    ['future version', () => ({ ...good(), version: SAVE_VERSION + 1 })],
    ['bad width', () => ({ ...good(), width: 3 })],
    ['truncated terrain', () => { const d = good(); d.terrain = d.terrain.slice(0, -2); return d; }],
    ['bad terrain value', () => { const d = good(); d.terrain[0] = 7; return d; }],
    ['bad rng', () => ({ ...good(), rng: [1, 2, 3] })],
    ['tax out of range', () => { const d = good(); d.taxRates.R = 50; return d; }],
    ['missing highway', () => {
      const d = good();
      d.road = [0, d.width * d.height];
      return d;
    }],
    ['overlapping buildings', () => {
      const d = good();
      const b = d.buildings[0].slice();
      b[0] = d.nextBuildingId;
      d.nextBuildingId++;
      d.buildings.push(b);
      return d;
    }],
    ['occupants over capacity', () => {
      const d = good();
      d.buildings[0][10] = d.buildings[0][9] + 1;
      return d;
    }],
  ];

  for (const [label, make] of cases) {
    it(`rejects ${label}`, () => {
      expect(() => loadSimulation(make())).toThrow(SaveError);
    });
  }

  it('SaveError is a named Error subclass', () => {
    let err;
    try {
      loadSimulation({});
    } catch (e) {
      err = e;
    }
    expect(err instanceof Error).toBe(true);
    expect(err.name).toBe('SaveError');
  });
});
