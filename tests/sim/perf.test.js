// Headless perf smoke test: 128×128 city with ~500 buildings, then one game year.
import { describe, it, expect } from 'vitest';
import { createSimulation } from '../../src/sim/index.js';
import { rect } from './helpers.js';

/** Grid of streets every 9 tiles, connected to the highway, zoned in bands. */
function bigCity(seed = 42) {
  const sim = createSimulation({ seed, width: 128, height: 128, name: 'Perfopolis' });
  const y0 = sim.getWorld().outsideConnection.y;
  sim.placeRoad({ x: 6, y: y0 }, { x: 120, y: y0 });
  for (let x = 10; x <= 120; x += 9) {
    // Vertical streets; skip segments that would cross water.
    for (const [a, b] of [[y0, 8], [y0, 120]]) {
      const r = sim.placeRoad({ x, y: a }, { x, y: b });
      if (!r.ok) {
        // Shorten until valid.
        const dir = Math.sign(b - a);
        for (let e = b; e !== a; e -= dir * 4) if (sim.placeRoad({ x, y: a }, { x, y: e }).ok) break;
      }
    }
  }
  for (let y = 8; y <= 120; y += 9) {
    if (y === y0) continue;
    for (let x = 10; x < 120; x += 9) sim.placeRoad({ x, y }, { x: x + 9, y });
  }
  const all = rect(6, 4, 124, 124);
  sim.paintZone(all.filter((c) => c.x < 50), 'R');
  sim.paintZone(all.filter((c) => c.x >= 50 && c.x < 85), 'C');
  sim.paintZone(all.filter((c) => c.x >= 85), 'I');
  return sim;
}

describe('performance smoke', () => {
  it('runs one game year on a 128×128 city with ~500 buildings', () => {
    const sim = bigCity();
    const zoneT0 = performance.now();
    // Grow until ~500 buildings (bounded).
    let warmDays = 0;
    while (sim.getStats().buildings.total < 500 && warmDays < 720) {
      sim.step(24);
      warmDays++;
    }
    const warmMs = performance.now() - zoneT0;
    const n = sim.getStats().buildings.total;
    expect(n).toBeGreaterThanOrEqual(450);

    let worstDay = 0;
    let dayStart = performance.now();
    const off = sim.on('day', () => {
      const t = performance.now();
      worstDay = Math.max(worstDay, t - dayStart);
      dayStart = t;
    });
    const t0 = performance.now();
    sim.step(24 * 360);
    const yearMs = performance.now() - t0;
    off();
    const s = sim.getStats();
    console.log(
      `[perf] warm-up ${warmDays} days to ${n} buildings: ${warmMs.toFixed(0)}ms; ` +
        `1 game year (8640 ticks) with ${s.buildings.total} buildings, pop ${s.population}: ` +
        `${yearMs.toFixed(0)}ms total, ${(yearMs / 360).toFixed(2)}ms/day avg, worst day ${worstDay.toFixed(2)}ms`,
    );
    expect(s.population).toBeGreaterThan(0);
    // Generous ceiling so CI noise doesn't flake; real numbers are reported above.
    expect(yearMs).toBeLessThan(10000);
  });
});
