// Shared test helpers (not a test file). Build cities only through the public API.
import { createSimulation } from '../../src/sim/index.js';

export const SEED = 42; // seed 42: rows 56..72 west of x=70 are water-free (asserted below)
export const DAY = 24;

/** Cells of the rectangle x0..x1, y0..y1 inclusive. */
export function rect(x0, y0, x1, y1) {
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
}

/**
 * Highway → street east along the outside-connection row, with R, C and I
 * bands zoned on both sides. Returns { sim, y, built } where `built` is the
 * road placement result.
 */
export function buildTown({ seed = SEED, width = 128, height = 128, roadTo = 60 } = {}) {
  const sim = createSimulation({ seed, width, height, name: 'Testville' });
  const y = sim.getWorld().outsideConnection.y;
  for (const t of sim.getTilesInRect(0, y - 4, roadTo, y + 4)) {
    if (t.terrain !== 'grass') throw new Error(`helper assumption broken: water at ${t.x},${t.y} for seed ${seed}`);
  }
  const built = sim.placeRoad({ x: 6, y }, { x: roadTo, y });
  if (!built.ok) throw new Error('helper road failed: ' + built.message);
  const band = (x0, x1) => rect(x0, y - 4, x1, y + 4).filter((c) => c.y !== y);
  sim.paintZone(band(6, 29), 'R');
  sim.paintZone(band(30, 44), 'C');
  sim.paintZone(band(45, roadTo), 'I');
  return { sim, y, built };
}

/** Run `days` whole days, collecting each day's stats. */
export function runDays(sim, days) {
  const log = [];
  const off = sim.on('statsChanged', ({ stats }) => log.push(stats));
  sim.step(days * DAY);
  off();
  return log;
}

/** Remove fields that legitimately differ between two otherwise identical sims. */
export function allTiles(sim) {
  const { width, height } = sim.getWorld();
  return sim.getTilesInRect(0, 0, width - 1, height - 1);
}
