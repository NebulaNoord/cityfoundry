import { describe, it, expect, beforeEach } from 'vitest';
import { createSimulation } from '../../src/sim/index.js';
import { SEED, DAY, rect, buildTown } from './helpers.js';

let sim;
let y;
beforeEach(() => {
  sim = createSimulation({ seed: SEED });
  y = sim.getWorld().outsideConnection.y;
  sim.placeRoad({ x: 6, y }, { x: 20, y });
});

describe('paintZone', () => {
  it('zones only tiles with road access, skipping roads, and is free', () => {
    // Column x=12 from y-6..y+6: road at y, access for |dy|<=4.
    const cells = rect(12, y - 6, 12, y + 6);
    const r = sim.paintZone(cells, 'R');
    expect(r.ok).toBe(true);
    expect(r.cost).toBe(0);
    expect(r.changed).toHaveLength(8);
    expect(sim.getTile(12, y - 4).zone).toBe('R');
    expect(sim.getTile(12, y + 4).zone).toBe('R');
    expect(sim.getTile(12, y - 5).zone).toBeNull();
    expect(sim.getTile(12, y).zone).toBeNull(); // road tile
    expect(sim.getStats().funds).toBe(49850);
  });

  it('returns only actually changed tiles', () => {
    sim.paintZone(rect(10, y - 2, 11, y - 1), 'C');
    const r = sim.paintZone(rect(10, y - 3, 11, y - 1), 'C');
    expect(r.changed).toHaveLength(2);
    const r2 = sim.paintZone(rect(10, y - 3, 11, y - 1), 'I');
    expect(r2.changed).toHaveLength(6);
    expect(sim.getTile(10, y - 2).zone).toBe('I');
  });

  it('NO_ROAD_ACCESS when nothing in the brush has access', () => {
    const r = sim.paintZone(rect(60, 10, 62, 12), 'R');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('NO_ROAD_ACCESS');
    expect(sim.getTile(61, 11).zone).toBeNull();
  });

  it('skips water tiles', () => {
    // Find a lake tile, put a road near it, paint over it.
    const lake = sim.getTilesInRect(0, 0, 127, 127).find((t) => t.terrain === 'water' && t.y > 2 && t.y < 125);
    const free = sim.getTilesInRect(lake.x - 4, lake.y - 4, lake.x + 4, lake.y + 4).find((t) => t.terrain === 'grass');
    sim.placeRoad({ x: free.x, y: free.y }, { x: free.x, y: free.y });
    const r = sim.paintZone([{ x: lake.x, y: lake.y }], 'R');
    expect(r.ok).toBe(true);
    expect(r.changed).toHaveLength(0);
    expect(sim.getTile(lake.x, lake.y).zone).toBeNull();
  });

  it('dezone with null works without road access', () => {
    sim.paintZone(rect(10, y - 2, 11, y - 1), 'R');
    sim.bulldoze(rect(6, y, 20, y)); // remove all roads -> no access
    expect(sim.getTile(10, y - 2).roadAccess).toBe(false);
    expect(sim.getTile(10, y - 2).zone).toBe('R');
    const r = sim.paintZone(rect(10, y - 2, 11, y - 1), null);
    expect(r.ok).toBe(true);
    expect(r.changed).toHaveLength(4);
    expect(sim.getTile(10, y - 2).zone).toBeNull();
  });

  it('rejects invalid zone and cells', () => {
    expect(sim.paintZone([{ x: 1, y: 1 }], 'X').error).toBe('INVALID');
    expect(sim.paintZone([{ x: 1 }], 'R').error).toBe('INVALID');
    expect(sim.paintZone(null, 'R').error).toBe('INVALID');
  });
});

describe('dezoning a building', () => {
  it('marks the building for abandonment after 5 days', () => {
    const { sim: town } = buildTown();
    town.step(10 * DAY);
    const b = town.getBuildings().find((x) => x.state === 'active');
    expect(b).toBeTruthy();
    town.paintZone([{ x: b.x, y: b.y }], null);
    town.step(4 * DAY);
    expect(town.getBuilding(b.id).state).toBe('active');
    town.step(1 * DAY);
    expect(town.getBuilding(b.id).state).toBe('abandoned');
    expect(town.getBuilding(b.id).occupants).toBe(0);
  });

  it('rezoning in time saves the building', () => {
    const { sim: town } = buildTown();
    town.step(10 * DAY);
    const b = town.getBuildings().find((x) => x.state === 'active');
    town.paintZone([{ x: b.x, y: b.y }], null);
    town.step(3 * DAY);
    town.paintZone([{ x: b.x, y: b.y }], b.zone);
    town.step(10 * DAY);
    expect(town.getBuilding(b.id).state).toBe('active');
  });
});
