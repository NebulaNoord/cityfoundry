import { describe, it, expect } from 'vitest';
import { createSimulation, loadSimulation } from '../../src/sim/index.js';
import { SEED, DAY, rect, buildTown } from './helpers.js';

describe('events', () => {
  it('tilesChanged reports cells and chunks, and bumps chunk versions', () => {
    const sim = createSimulation({ seed: SEED });
    const y = sim.getWorld().outsideConnection.y;
    const events = [];
    sim.on('tilesChanged', (e) => events.push(e));
    const v0 = sim.getChunkVersion(1, 4);
    sim.placeRoad({ x: 6, y }, { x: 20, y });
    expect(events).toHaveLength(1);
    const { cells, chunks } = events[0];
    // Road tiles plus tiles whose roadAccess/connected/landValue flipped.
    for (let x = 6; x <= 20; x++) expect(cells.some((c) => c.x === x && c.y === y)).toBe(true);
    expect(cells.some((c) => c.x === 22 && c.y === y + 3)).toBe(true); // newly roadAccess
    expect(chunks.some((c) => c.cx === 1 && c.cy === 4)).toBe(true);
    expect(sim.getChunkVersion(1, 4)).toBeGreaterThan(v0);
    // Untouched chunk unchanged.
    expect(sim.getChunkVersion(7, 0)).toBe(0);
  });

  it('statsChanged fires after money-costing commands and each day; not for free no-ops', () => {
    const sim = createSimulation({ seed: SEED });
    const y = sim.getWorld().outsideConnection.y;
    const got = [];
    sim.on('statsChanged', ({ stats }) => got.push(stats));
    sim.placeRoad({ x: 6, y }, { x: 9, y });
    expect(got).toHaveLength(1);
    expect(got[0].funds).toBe(49960);
    sim.placeRoad({ x: 6, y }, { x: 9, y }); // free, nothing changes
    expect(got).toHaveLength(1);
    sim.step(DAY);
    expect(got).toHaveLength(2);
    expect(got[1].daily.expenses).toBeCloseTo(2, 6);
  });

  it('building lifecycle events carry snapshots', () => {
    const { sim } = buildTown();
    const added = [];
    const changed = [];
    const removed = [];
    sim.on('buildingAdded', ({ building }) => added.push(building));
    sim.on('buildingChanged', ({ building }) => changed.push(building));
    sim.on('buildingRemoved', ({ building }) => removed.push(building));
    sim.step(5 * DAY);
    expect(added.length).toBeGreaterThan(0);
    expect(changed.some((b) => b.id === added[0].id && b.state === 'active')).toBe(true);
    const target = added[0];
    sim.bulldoze([{ x: target.x, y: target.y }]);
    expect(removed).toHaveLength(1);
    expect(removed[0].id).toBe(target.id);
  });

  it('a throwing handler is caught and does not break the sim or other handlers', () => {
    const sim = createSimulation({ seed: 1, width: 16, height: 16 });
    const errors = console.error;
    let logged = 0;
    console.error = () => logged++;
    try {
      let after = 0;
      sim.on('tick', () => {
        throw new Error('boom');
      });
      sim.on('tick', () => after++);
      sim.step(3);
      expect(after).toBe(3);
      expect(logged).toBe(3);
      expect(sim.getTime().tick).toBe(3);
    } finally {
      console.error = errors;
    }
  });

  it('unsubscribe works and unknown events throw', () => {
    const sim = createSimulation({ seed: 1, width: 16, height: 16 });
    let n = 0;
    const off = sim.on('tick', () => n++);
    sim.step(2);
    off();
    off();
    sim.step(2);
    expect(n).toBe(2);
    expect(() => sim.on('nope', () => {})).toThrow(TypeError);
  });

  it('low-funds notification fires once when crossing $5,000', () => {
    const base = createSimulation({ seed: SEED });
    const data = base.serialize();
    data.fundsCents = 6000 * 100;
    const sim = loadSimulation(data);
    const y = sim.getWorld().outsideConnection.y;
    const notes = [];
    sim.on('notification', (n) => notes.push(n));
    sim.placeRoad({ x: 6, y }, { x: 115, y: y }); // $1100 -> $4900
    expect(sim.getStats().funds).toBe(4900);
    expect(notes).toHaveLength(1);
    expect(notes[0].level).toBe('warn');
    expect(notes[0].message).toContain('Funds are low');
    expect(typeof notes[0].id).toBe('number');
    sim.step(3 * DAY); // still low: no repeat
    expect(notes.filter((n) => n.message.includes('Funds are low'))).toHaveLength(1);
    const list = sim.getNotifications();
    expect(list[0]).toEqual({ id: notes[0].id, tick: 0, level: 'warn', message: notes[0].message });
  });

  it('debt alert fires when funds go negative from upkeep', () => {
    const base = createSimulation({ seed: SEED });
    const data = base.serialize();
    data.fundsCents = 2000 * 100;
    const sim = loadSimulation(data);
    // Avenues all over an empty map: high upkeep, no income.
    for (let row = 2; row < 40; row += 6) sim.placeRoad({ x: 70, y: row }, { x: 75, y: row }, 'avenue');
    const funds = sim.getStats().funds;
    const upkeep = 7 * 6 * 1.2;
    sim.step(Math.ceil(funds / upkeep + 1) * DAY);
    expect(sim.getStats().funds).toBeLessThan(0);
    expect(sim.getNotifications().some((n) => n.level === 'alert' && /debt/.test(n.message))).toBe(true);
  });

  it('getNotifications is newest-first and respects limit', () => {
    const sim = createSimulation({ seed: SEED });
    const y = sim.getWorld().outsideConnection.y;
    sim.placeRoad({ x: 10, y }, { x: 20, y });
    sim.paintZone(rect(10, y - 2, 20, y - 1), 'R');
    sim.step(70 * DAY); // disconnected zoning warning is rate-limited to monthly
    const all = sim.getNotifications(50);
    expect(all.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < all.length; i++) expect(all[i - 1].id).toBeGreaterThan(all[i].id);
    expect(sim.getNotifications(1)).toHaveLength(1);
    expect(sim.getNotifications(1)[0]).toEqual(all[0]);
  });
});
