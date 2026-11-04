import { describe, it, expect } from 'vitest';
import { createSimulation } from '../../src/sim/index.js';
import { SEED, DAY, rect, buildTown, runDays } from './helpers.js';

describe('growth end-to-end', () => {
  it('road from highway + R/C/I zoning grows a working city in 60 days', () => {
    const { sim, built } = buildTown();
    expect(built.cost).toBe(550);
    const funds0 = sim.getStats().funds;
    expect(funds0).toBe(50000 - 550);

    const daily = runDays(sim, 60);
    expect(daily).toHaveLength(60);
    const s = sim.getStats();
    expect(s.population).toBeGreaterThan(0);
    expect(s.population).toBe(s.households * 3);
    expect(s.jobs.C).toBeGreaterThan(0);
    expect(s.jobs.I).toBeGreaterThan(0);
    expect(s.jobs.total).toBe(s.jobs.C + s.jobs.I);
    expect(s.workers).toBe(s.jobs.total);
    expect(s.jobs.C).toBeLessThanOrEqual(s.jobCapacity.C);
    expect(s.jobs.I).toBeLessThanOrEqual(s.jobCapacity.I);
    expect(s.buildings.R).toBeGreaterThan(0);
    expect(s.buildings.C).toBeGreaterThan(0);
    expect(s.buildings.I).toBeGreaterThan(0);

    // Funds change == sum of each day's reported net (no hidden money flows).
    const netSum = daily.reduce((a, d) => a + d.daily.net, 0);
    expect(s.funds).toBeCloseTo(funds0 + netSum, 6);
    // Each day: net = income - expenses, expenses = 55 street tiles * $0.5.
    for (const d of daily) {
      expect(d.daily.net).toBeCloseTo(d.daily.income - d.daily.expenses, 6);
      expect(d.daily.expenses).toBeCloseTo(27.5, 6);
    }
    expect(daily[59].daily.income).toBeGreaterThan(daily[5].daily.income);
  });

  it('stats are consistent with the building list', () => {
    const { sim } = buildTown();
    sim.step(45 * DAY);
    const blds = sim.getBuildings();
    const s = sim.getStats();
    const active = blds.filter((b) => b.state === 'active');
    const households = active.filter((b) => b.zone === 'R').reduce((a, b) => a + b.occupants, 0);
    const jobsC = active.filter((b) => b.zone === 'C').reduce((a, b) => a + b.occupants, 0);
    const capI = active.filter((b) => b.zone === 'I').reduce((a, b) => a + b.capacity, 0);
    expect(s.households).toBe(households);
    expect(s.jobs.C).toBe(jobsC);
    expect(s.jobCapacity.I).toBe(capI);
    expect(s.buildings.total).toBe(blds.length);
    for (const b of blds) {
      expect(b.occupants).toBeLessThanOrEqual(b.capacity);
      const t = sim.getTile(b.x, b.y);
      expect(t.buildingId).toBe(b.id);
      expect(t.zone).toBe(b.zone);
      expect(t.connected).toBe(true);
      expect(b.w).toBe(1);
      expect(b.level).toBe(1);
    }
  });

  it('buildings take 3 days to construct, and only active buildings hold occupants', () => {
    const { sim } = buildTown();
    const added = [];
    sim.on('buildingAdded', ({ building }) => added.push(building));
    sim.step(1 * DAY);
    expect(added.length).toBeGreaterThan(0);
    const first = added[0];
    expect(first.state).toBe('constructing');
    expect(first.constructionProgress).toBe(0);
    expect(first.occupants).toBe(0);
    expect(first.builtTick).toBe(24);
    sim.step(DAY);
    expect(sim.getBuilding(first.id).constructionProgress).toBeCloseTo(1 / 3, 6);
    sim.step(DAY);
    expect(sim.getBuilding(first.id).state).toBe('constructing');
    expect(sim.getBuilding(first.id).occupants).toBe(0);
    sim.step(DAY);
    expect(sim.getBuilding(first.id).state).toBe('active');
    expect(sim.getBuilding(first.id).constructionProgress).toBe(1);
  });

  it('spawning prefers higher land value', () => {
    const { sim } = buildTown();
    sim.step(30 * DAY);
    const blds = sim.getBuildings().filter((b) => b.zone === 'R');
    const zonedEmpty = sim
      .getTilesInRect(6, 0, 29, 127)
      .filter((t) => t.zone === 'R' && t.buildingId === null);
    const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const builtLV = avg(blds.map((b) => sim.getTile(b.x, b.y).landValue));
    const emptyLV = avg(zonedEmpty.map((t) => t.landValue));
    expect(builtLV).toBeGreaterThan(emptyLV);
  });
});

describe('connectivity gates growth', () => {
  it('a disconnected network grows nothing; connecting it starts growth', () => {
    const sim = createSimulation({ seed: SEED });
    const y = sim.getWorld().outsideConnection.y;
    // Road 3 tiles short of the highway end (x=6 is left empty).
    expect(sim.placeRoad({ x: 8, y }, { x: 40, y }).ok).toBe(true);
    expect(sim.getRoadNetwork().components).toBe(2);
    const band = rect(10, y - 4, 40, y + 4).filter((c) => c.y !== y);
    sim.paintZone(band.filter((c) => c.x < 25), 'R');
    sim.paintZone(band.filter((c) => c.x >= 25 && c.x < 32), 'C');
    sim.paintZone(band.filter((c) => c.x >= 32), 'I');
    expect(sim.getTile(12, y - 1).roadAccess).toBe(true);
    expect(sim.getTile(12, y - 1).connected).toBe(false);

    const notes = [];
    sim.on('notification', (n) => notes.push(n));
    sim.step(20 * DAY);
    expect(sim.getBuildings()).toHaveLength(0);
    expect(sim.getStats().population).toBe(0);
    expect(notes.some((n) => n.level === 'warn' && /not connected/.test(n.message))).toBe(true);

    expect(sim.placeRoad({ x: 6, y }, { x: 7, y }).ok).toBe(true);
    expect(sim.getRoadNetwork().components).toBe(1);
    expect(sim.getTile(12, y - 1).connected).toBe(true);
    sim.step(20 * DAY);
    expect(sim.getBuildings().length).toBeGreaterThan(0);
    expect(sim.getStats().population).toBeGreaterThan(0);
  });
});

describe('abandonment', () => {
  it('cutting the road connection abandons buildings after 5 days and they empty out', () => {
    const { sim, y } = buildTown();
    sim.step(30 * DAY);
    const before = sim.getStats();
    expect(before.population).toBeGreaterThan(0);
    // Cut the link to the highway.
    expect(sim.bulldoze([{ x: 6, y }]).ok).toBe(true);
    expect(sim.getTile(10, y - 1).connected).toBe(false);
    const changed = [];
    sim.on('buildingChanged', ({ building }) => changed.push(building));
    sim.step(4 * DAY);
    expect(sim.getBuildings().some((b) => b.state === 'abandoned')).toBe(false);
    sim.step(1 * DAY);
    const blds = sim.getBuildings();
    // Tiles within 4 of the highway stub itself (x <= 9) stay connected.
    const cut = blds.filter((b) => !sim.getTile(b.x, b.y).connected);
    const kept = blds.filter((b) => sim.getTile(b.x, b.y).connected);
    expect(cut.length).toBeGreaterThan(0);
    expect(cut.every((b) => b.x >= 10)).toBe(true);
    expect(cut.every((b) => b.state === 'abandoned' && b.occupants === 0)).toBe(true);
    expect(kept.every((b) => b.state !== 'abandoned')).toBe(true);
    expect(changed.some((b) => b.state === 'abandoned')).toBe(true);
    const after = sim.getStats();
    expect(after.population).toBeLessThan(before.population);
    const liveHouseholds = kept.filter((b) => b.zone === 'R' && b.state === 'active').reduce((a, b) => a + b.occupants, 0);
    expect(after.households).toBe(liveHouseholds);
    expect(after.buildings.total).toBe(blds.length); // abandoned still count as structures
    expect(sim.getNotifications().some((n) => /abandoned/.test(n.message))).toBe(true);

    // Abandoned buildings block spawning until bulldozed; reconnecting does not revive them.
    sim.placeRoad({ x: 6, y }, { x: 6, y });
    sim.step(5 * DAY);
    expect(sim.getBuildings().filter((b) => b.state !== 'abandoned').length).toBeGreaterThan(0); // new growth on free tiles
    const ab = sim.getBuildings().find((b) => b.state === 'abandoned');
    expect(sim.bulldoze([{ x: ab.x, y: ab.y }]).ok).toBe(true);
    expect(sim.getTile(ab.x, ab.y).buildingId).toBeNull();
  });
});

describe('taxes', () => {
  it('higher tax lowers demand for that zone, lower tax raises it', () => {
    const { sim } = buildTown();
    sim.step(20 * DAY);
    const base = sim.getStats().demand;
    expect(sim.setTaxRate('R', 19).ok).toBe(true);
    const high = sim.getStats().demand;
    expect(high.R).toBeLessThan(base.R);
    expect(high.C).toBe(base.C);
    sim.setTaxRate('R', 9);
    expect(sim.getStats().demand).toEqual(base);
    sim.setTaxRate('I', 0);
    expect(sim.getStats().demand.I).toBeGreaterThan(base.I);
  });

  it('a punitive R tax stops residential growth vs. a default-tax twin', () => {
    const a = buildTown().sim;
    const b = buildTown().sim;
    b.setTaxRate('R', 29);
    a.step(40 * DAY);
    b.step(40 * DAY);
    expect(b.getStats().households).toBeLessThan(a.getStats().households);
    expect(b.getStats().demand.R).toBeLessThan(0);
  });

  it('tax rate scales income for the same city', () => {
    const { sim } = buildTown();
    sim.step(40 * DAY);
    const s0 = sim.getStats();
    // Same households/jobs over one more day only if nothing changes; compute expected from stats.
    sim.setTaxRate('R', 18);
    sim.setTaxRate('C', 18);
    sim.setTaxRate('I', 18);
    sim.step(DAY);
    const s1 = sim.getStats();
    const expected = (s1.households * 18 * 15 + s1.jobs.C * 18 * 20 + s1.jobs.I * 18 * 18) / 100;
    expect(s1.daily.income).toBeCloseTo(expected, 6);
    expect(s1.daily.income).toBeGreaterThan(s0.daily.income);
  });

  it('validates tax input', () => {
    const sim = createSimulation({ seed: 1, width: 16, height: 16 });
    expect(sim.setTaxRate('X', 5).error).toBe('INVALID');
    expect(sim.setTaxRate('R', 30).error).toBe('INVALID');
    expect(sim.setTaxRate('R', -1).error).toBe('INVALID');
    expect(sim.setTaxRate('R', 5.5).error).toBe('INVALID');
    expect(sim.getStats().taxRates).toEqual({ R: 9, C: 9, I: 9 });
  });
});

describe('land value', () => {
  it('base 30, raised near roads and commercial, lowered near industry', () => {
    const sim = createSimulation({ seed: SEED });
    expect(sim.getTile(100, 10).landValue).toBe(30);
    const { sim: town, y } = buildTown();
    expect(town.getTile(15, y - 1).landValue).toBe(45); // road within 2
    expect(town.getTile(15, y - 4).landValue).toBe(38); // road within 4
    town.step(40 * DAY);
    const c = town.getBuildings().find((b) => b.zone === 'C' && b.state === 'active');
    const i = town.getBuildings().find((b) => b.zone === 'I' && b.state === 'active');
    expect(c).toBeTruthy();
    expect(i).toBeTruthy();
    // Near commercial is above the road-only value, near industry below it.
    expect(town.getTile(c.x, c.y).landValue).toBeGreaterThan(45);
    expect(town.getTile(i.x, i.y).landValue).toBeLessThan(38);
  });
});
