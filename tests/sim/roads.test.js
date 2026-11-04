import { describe, it, expect, beforeEach } from 'vitest';
import { createSimulation, loadSimulation } from '../../src/sim/index.js';
import { SEED, DAY, allTiles, buildTown } from './helpers.js';

let sim;
let y;
beforeEach(() => {
  sim = createSimulation({ seed: SEED });
  y = sim.getWorld().outsideConnection.y;
});

/** A sim identical to `sim` but with the given funds (via the save format). */
function withFunds(s, dollars) {
  const data = s.serialize();
  data.fundsCents = dollars * 100;
  return loadSimulation(data);
}

describe('previewRoad', () => {
  it('straight path, cost, and no mutation', () => {
    const before = allTiles(sim);
    const p = sim.previewRoad({ x: 6, y }, { x: 15, y });
    expect(p.valid).toBe(true);
    expect(p.path).toHaveLength(10);
    expect(p.path[0]).toEqual({ x: 6, y });
    expect(p.path[9]).toEqual({ x: 15, y });
    expect(p.cost).toBe(100);
    expect(p.error).toBe(undefined);
    expect(allTiles(sim)).toEqual(before);
    expect(sim.getStats().funds).toBe(50000);
  });

  it('L path goes horizontal first', () => {
    const p = sim.previewRoad({ x: 10, y: 60 }, { x: 13, y: 58 });
    expect(p.path).toEqual([
      { x: 10, y: 60 }, { x: 11, y: 60 }, { x: 12, y: 60 }, { x: 13, y: 60 },
      { x: 13, y: 59 }, { x: 13, y: 58 },
    ]);
    expect(p.cost).toBe(60);
  });

  it('avenue costs $25/tile, existing same-type and highway tiles are free', () => {
    expect(sim.previewRoad({ x: 6, y }, { x: 9, y }, 'avenue').cost).toBe(100);
    // Highway tiles in the path are free and stay highway.
    expect(sim.previewRoad({ x: 0, y }, { x: 9, y }).cost).toBe(40);
    sim.placeRoad({ x: 6, y }, { x: 9, y });
    expect(sim.previewRoad({ x: 6, y }, { x: 12, y }).cost).toBe(30);
    // Upgrading streets to avenue is charged at avenue price.
    expect(sim.previewRoad({ x: 6, y }, { x: 9, y }, 'avenue').cost).toBe(100);
  });

  it('reports errors without mutating', () => {
    const oob = sim.previewRoad({ x: 120, y: 10 }, { x: 130, y: 10 });
    expect(oob.valid).toBe(false);
    expect(oob.error).toBe('OUT_OF_BOUNDS');
    expect(sim.previewRoad({ x: 1, y: 1 }, { x: 2, y: 1 }, 'highway').error).toBe('INVALID');
    expect(sim.previewRoad({ x: 1, y: 1 }, { x: 2, y: 1 }, 'dirt').error).toBe('INVALID');
    expect(sim.previewRoad(null, { x: 2, y: 1 }).error).toBe('INVALID');
  });
});

describe('placeRoad', () => {
  it('builds the path, charges funds and reports changed tiles', () => {
    const r = sim.placeRoad({ x: 6, y }, { x: 15, y });
    expect(r.ok).toBe(true);
    expect(r.cost).toBe(100);
    expect(r.changed).toHaveLength(10);
    expect(sim.getStats().funds).toBe(49900);
    expect(sim.getTile(10, y).road).toEqual({ type: 'street' });
    expect(sim.getTile(10, y).connected).toBe(true);
    expect(sim.getRoadNetwork()).toEqual({ tiles: 16, components: 1, connectedTiles: 16 });
    // Rebuilding the same road is free and changes nothing.
    const again = sim.placeRoad({ x: 6, y }, { x: 15, y });
    expect(again).toEqual({ ok: true, cost: 0, changed: [] });
    expect(sim.getStats().funds).toBe(49900);
  });

  it('upgrades street to avenue and updates upkeep', () => {
    sim.placeRoad({ x: 6, y }, { x: 15, y });
    const r = sim.placeRoad({ x: 6, y }, { x: 15, y }, 'avenue');
    expect(r.ok).toBe(true);
    expect(r.cost).toBe(250);
    expect(sim.getTile(6, y).road.type).toBe('avenue');
    sim.step(DAY);
    expect(sim.getStats().daily.expenses).toBeCloseTo(10 * 1.2, 6);
  });

  it('INSUFFICIENT_FUNDS is atomic', () => {
    const poor = withFunds(sim, 95);
    const before = allTiles(poor);
    const r = poor.placeRoad({ x: 6, y }, { x: 15, y }); // $100
    expect(r.ok).toBe(false);
    expect(r.error).toBe('INSUFFICIENT_FUNDS');
    expect(typeof r.message).toBe('string');
    expect(poor.getStats().funds).toBe(95);
    expect(allTiles(poor)).toEqual(before);
    expect(poor.placeRoad({ x: 6, y }, { x: 14, y }).ok).toBe(true); // exactly $90 is fine
    expect(poor.getStats().funds).toBe(5);
  });

  it('WATER and OUT_OF_BOUNDS are atomic', () => {
    const lake = allTiles(sim).find((t) => t.terrain === 'water');
    const before = allTiles(sim);
    const r = sim.placeRoad({ x: lake.x - 3 < 0 ? lake.x + 3 : lake.x - 3, y: lake.y }, { x: lake.x, y: lake.y });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('WATER');
    const o = sim.placeRoad({ x: 125, y: 3 }, { x: 128, y: 3 });
    expect(o.error).toBe('OUT_OF_BOUNDS');
    expect(allTiles(sim)).toEqual(before);
    expect(sim.getStats().funds).toBe(50000);
  });

  it('road on a zoned tile clears the zone; road on a building is BLOCKED', () => {
    const { sim: town, y: ty } = buildTown();
    expect(town.getTile(10, ty - 2).zone).toBe('R');
    const r = town.placeRoad({ x: 10, y: ty - 1 }, { x: 10, y: ty - 3 });
    expect(r.ok).toBe(true);
    expect(town.getTile(10, ty - 2).zone).toBeNull();
    expect(town.getTile(10, ty - 2).road).toEqual({ type: 'street' });

    town.step(10 * DAY);
    const b = town.getBuildings()[0];
    const funds = town.getStats().funds;
    const blocked = town.placeRoad({ x: b.x, y: b.y }, { x: b.x, y: b.y });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe('BLOCKED');
    expect(town.getStats().funds).toBe(funds);
    expect(town.getTile(b.x, b.y).road).toBeNull();
  });
});

describe('bulldoze', () => {
  it('removes roads, refunds nothing, updates network', () => {
    sim.placeRoad({ x: 6, y }, { x: 15, y });
    const r = sim.bulldoze([{ x: 10, y }]);
    expect(r.ok).toBe(true);
    expect(r.cost).toBe(0);
    expect(r.changed).toEqual([{ x: 10, y }]);
    expect(sim.getStats().funds).toBe(49900);
    expect(sim.getTile(10, y).road).toBeNull();
    // Split: highway+6..9 connected, 11..15 is a second, disconnected component.
    expect(sim.getRoadNetwork()).toEqual({ tiles: 15, components: 2, connectedTiles: 10 });
    expect(sim.getTile(13, y).road).toEqual({ type: 'street' });
    expect(sim.getTile(13, y).roadAccess).toBe(true);
    expect(sim.getTile(19, y).connected).toBe(false);
    expect(sim.getTile(19, y).roadAccess).toBe(true);
  });

  it('highway stub is PROTECTED alone and skipped when mixed', () => {
    const r = sim.bulldoze([{ x: 2, y }]);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('PROTECTED');
    sim.placeRoad({ x: 6, y }, { x: 8, y });
    const mixed = sim.bulldoze([{ x: 2, y }, { x: 8, y }]);
    expect(mixed.ok).toBe(true);
    expect(mixed.changed).toEqual([{ x: 8, y }]);
    expect(sim.getTile(2, y).road).toEqual({ type: 'highway' });
  });

  it('removes building first, then road, then zone; rejects bad input', () => {
    const { sim: town, y: ty } = buildTown();
    town.step(5 * DAY);
    const b = town.getBuildings()[0];
    expect(town.bulldoze([{ x: b.x, y: b.y }]).ok).toBe(true);
    expect(town.getBuilding(b.id)).toBeNull();
    expect(town.getTile(b.x, b.y).zone).not.toBeNull(); // zone kept
    town.bulldoze([{ x: b.x, y: b.y }]);
    expect(town.getTile(b.x, b.y).zone).toBeNull();
    expect(town.bulldoze('nope').error).toBe('INVALID');
    expect(town.bulldoze([{ x: 999, y: 0 }]).error).toBe('OUT_OF_BOUNDS');
    expect(town.getTile(20, ty).road).toEqual({ type: 'street' });
  });
});

describe('connectivity', () => {
  it('a road network not touching the highway is not connected', () => {
    sim.placeRoad({ x: 20, y: y + 8 }, { x: 40, y: y + 8 });
    expect(sim.getRoadNetwork()).toEqual({ tiles: 27, components: 2, connectedTiles: 6 });
    const t = sim.getTile(30, y + 9);
    expect(t.roadAccess).toBe(true);
    expect(t.connected).toBe(false);
    // Connect it: L from the highway end east then south.
    sim.placeRoad({ x: 6, y }, { x: 20, y: y + 7 });
    expect(sim.getRoadNetwork().components).toBe(1);
    expect(sim.getTile(30, y + 9).connected).toBe(true);
    expect(sim.getRoadNetwork().connectedTiles).toBe(sim.getRoadNetwork().tiles);
  });

  it('roadAccess uses Chebyshev distance 4', () => {
    sim.placeRoad({ x: 20, y: 30 }, { x: 20, y: 30 });
    expect(sim.getTile(24, 34).roadAccess).toBe(true);
    expect(sim.getTile(16, 26).roadAccess).toBe(true);
    expect(sim.getTile(25, 30).roadAccess).toBe(false);
    expect(sim.getTile(20, 35).roadAccess).toBe(false);
  });
});
