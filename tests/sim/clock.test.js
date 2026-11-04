import { describe, it, expect } from 'vitest';
import { createSimulation } from '../../src/sim/index.js';

describe('calendar', () => {
  it('rolls hours, days, months and years', () => {
    const sim = createSimulation({ seed: 1, width: 16, height: 16 });
    sim.step(23);
    expect(sim.getTime()).toEqual({ tick: 23, hour: 23, day: 1, month: 1, year: 1, speed: 1 });
    sim.step(1);
    expect(sim.getTime()).toEqual({ tick: 24, hour: 0, day: 2, month: 1, year: 1, speed: 1 });
    sim.step(24 * 29);
    expect(sim.getTime()).toEqual({ tick: 720, hour: 0, day: 1, month: 2, year: 1, speed: 1 });
    sim.step(24 * 30 * 11 - 1);
    expect(sim.getTime()).toEqual({ tick: 8639, hour: 23, day: 30, month: 12, year: 1, speed: 1 });
    sim.step(1);
    expect(sim.getTime()).toEqual({ tick: 8640, hour: 0, day: 1, month: 1, year: 2, speed: 1 });
  });

  it('emits day events with the new date, after daily systems', () => {
    const sim = createSimulation({ seed: 1, width: 16, height: 16 });
    const days = [];
    sim.on('day', (d) => days.push(d));
    let ticks = 0;
    sim.on('tick', () => ticks++);
    sim.step(24 * 31);
    expect(ticks).toBe(24 * 31);
    expect(days).toHaveLength(31);
    expect(days[0]).toEqual({ day: 2, month: 1, year: 1 });
    expect(days[29]).toEqual({ day: 1, month: 2, year: 1 });
  });

  it('step ignores pause; step validates input', () => {
    const sim = createSimulation({ seed: 1, width: 16, height: 16 });
    sim.setSpeed(0);
    sim.step(5);
    expect(sim.getTime().tick).toBe(5);
    expect(() => sim.step(-1)).toThrow(RangeError);
    expect(() => sim.step(1.5)).toThrow(RangeError);
  });
});

describe('real-time driver', () => {
  it('speed 1/2/3 give 12/24/48 ticks per second', () => {
    for (const [speed, tps] of [[1, 12], [2, 24], [3, 48]]) {
      const sim = createSimulation({ seed: 1, width: 16, height: 16 });
      expect(sim.setSpeed(speed).ok).toBe(true);
      for (let i = 0; i < 60; i++) sim.update(1000 / 60);
      // 60 frames of 1/60 s = one second (allow float rounding of one tick)
      expect(Math.abs(sim.getTime().tick - tps)).toBeLessThanOrEqual(1);
      for (let i = 0; i < 600; i++) sim.update(1000 / 60);
      expect(Math.abs(sim.getTime().tick - tps * 11)).toBeLessThanOrEqual(1);
      expect(sim.getTime().speed).toBe(speed);
    }
  });

  it('pause stops time and accumulates nothing', () => {
    const sim = createSimulation({ seed: 1, width: 16, height: 16 });
    sim.setSpeed(0);
    expect(sim.update(5000)).toBe(0);
    expect(sim.getTime().tick).toBe(0);
    sim.setSpeed(1);
    sim.update(100); // 1.2 ticks
    expect(sim.getTime().tick).toBe(1);
  });

  it('backlog is capped at one real second of ticks', () => {
    const sim = createSimulation({ seed: 1, width: 16, height: 16 });
    sim.setSpeed(3);
    expect(sim.update(60_000)).toBe(48); // a minute asleep -> only 48 ticks
    expect(sim.getTime().tick).toBe(48);
    sim.setSpeed(1);
    expect(sim.update(10_000)).toBe(12);
  });

  it('ignores invalid dt and invalid speeds', () => {
    const sim = createSimulation({ seed: 1, width: 16, height: 16 });
    expect(sim.update(NaN)).toBe(0);
    expect(sim.update(-50)).toBe(0);
    expect(sim.update(Infinity)).toBe(0);
    expect(sim.setSpeed(4).error).toBe('INVALID');
    expect(sim.setSpeed(1.5).error).toBe('INVALID');
    expect(sim.getTime().speed).toBe(1);
  });
});
