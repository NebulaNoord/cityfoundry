import { describe, it, expect } from 'vitest';
import { createSimulation, CHUNK_SIZE, SAVE_VERSION } from '../../src/sim/index.js';
import { allTiles } from './helpers.js';

describe('world creation', () => {
  it('uses the documented defaults', () => {
    const sim = createSimulation({ seed: 1 });
    const w = sim.getWorld();
    expect(w.width).toBe(128);
    expect(w.height).toBe(128);
    expect(w.chunkSize).toBe(16);
    expect(CHUNK_SIZE).toBe(16);
    expect(w.name).toBe('New City');
    expect(w.seed).toBe(1);
    expect(w.outsideConnection).toEqual({ x: 0, y: 64 });
    expect(Number.isInteger(SAVE_VERSION)).toBeTruthy();
    expect(sim.getStats().funds).toBe(50000);
    expect(sim.getTime()).toEqual({ tick: 0, hour: 0, day: 1, month: 1, year: 1, speed: 1 });
  });

  it('same seed gives identical terrain; different seeds differ', () => {
    const a = allTiles(createSimulation({ seed: 'alpha' }));
    const b = allTiles(createSimulation({ seed: 'alpha' }));
    const c = allTiles(createSimulation({ seed: 'beta' }));
    expect(a).toEqual(b);
    const terrain = (tiles) => tiles.map((t) => t.terrain).join('');
    expect(terrain(a)).not.toBe(terrain(c));
  });

  it('generates some lakes but keeps the outside connection on dry land', () => {
    for (const seed of [1, 2, 3, 42, 'x', 999]) {
      const sim = createSimulation({ seed });
      const tiles = allTiles(sim);
      const water = tiles.filter((t) => t.terrain === 'water').length;
      expect(water).toBeGreaterThan(0);
      expect(water).toBeLessThan(tiles.length * 0.25);
      const { y } = sim.getWorld().outsideConnection;
      for (let x = 0; x < 6; x++) {
        const t = sim.getTile(x, y);
        expect(t.terrain).toBe('grass');
        expect(t.road).toEqual({ type: 'highway' });
        expect(t.connected).toBe(true);
      }
      // The tile right after the stub is buildable so the player can connect.
      expect(sim.getTile(6, y).terrain).toBe('grass');
    }
  });

  it('starts with one connected 6-tile road network', () => {
    const sim = createSimulation({ seed: 5 });
    expect(sim.getRoadNetwork()).toEqual({ tiles: 6, components: 1, connectedTiles: 6 });
  });

  it('getTile returns null out of bounds and the documented shape in bounds', () => {
    const sim = createSimulation({ seed: 5 });
    expect(sim.getTile(-1, 0)).toBeNull();
    expect(sim.getTile(0, 128)).toBeNull();
    expect(sim.getTile(1.5, 2)).toBeNull();
    const t = sim.getTile(100, 10);
    expect(Object.keys(t).sort()).toEqual(['buildingId', 'connected', 'landValue', 'road', 'roadAccess', 'terrain', 'x', 'y', 'zone']);
    expect(t.x).toBe(100);
    expect(t.y).toBe(10);
    expect(t.zone).toBeNull();
    expect(t.buildingId).toBeNull();
    expect(t.roadAccess).toBe(false);
  });

  it('queries return fresh copies that cannot mutate the sim', () => {
    const sim = createSimulation({ seed: 5 });
    const y = sim.getWorld().outsideConnection.y;
    const t = sim.getTile(2, y);
    t.road.type = 'street';
    t.terrain = 'water';
    expect(sim.getTile(2, y).road).toEqual({ type: 'highway' });
    expect(sim.getTile(2, y).terrain).toBe('grass');
    const w = sim.getWorld();
    w.outsideConnection.x = 50;
    expect(sim.getWorld().outsideConnection.x).toBe(0);
    const st = sim.getStats();
    st.taxRates.R = 99;
    st.funds = 1;
    expect(sim.getStats().taxRates.R).toBe(9);
    expect(sim.getStats().funds).toBe(50000);
  });

  it('getTilesInRect is inclusive, order-independent and clamped', () => {
    const sim = createSimulation({ seed: 5 });
    expect(sim.getTilesInRect(0, 0, 2, 1)).toHaveLength(6);
    expect(sim.getTilesInRect(2, 1, 0, 0)).toHaveLength(6);
    const clamped = sim.getTilesInRect(-10, -10, 1, 1);
    expect(clamped).toHaveLength(4);
    expect(clamped[0]).toEqual(sim.getTile(0, 0));
    expect(sim.getTilesInRect(126, 126, 500, 500)).toHaveLength(4);
  });

  it('rejects invalid map sizes and seeds', () => {
    expect(() => createSimulation({ width: 4, height: 4 })).toThrow(RangeError);
    expect(() => createSimulation({ width: 100.5 })).toThrow(RangeError);
    expect(() => createSimulation({ seed: {} })).toThrow(TypeError);
  });

  it('supports larger, non-square maps', () => {
    const sim = createSimulation({ seed: 9, width: 256, height: 192 });
    expect(sim.getWorld().outsideConnection).toEqual({ x: 0, y: 96 });
    expect(sim.getChunkVersion(15, 11)).toBe(0);
    expect(sim.getChunkVersion(16, 0)).toBeNull();
    expect(sim.getTile(255, 191)).not.toBeNull();
  });
});
