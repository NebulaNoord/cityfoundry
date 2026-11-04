// Calendar maths and the real-time driver (speed + capped backlog).

import {
  TICKS_PER_DAY,
  DAYS_PER_MONTH,
  MONTHS_PER_YEAR,
  TICKS_PER_SECOND,
} from './constants.js';

export function createClock() {
  return { tick: 0, speed: 1, acc: 0 };
}

/** Calendar for an absolute tick. Tick 0 = Year 1, Month 1, Day 1, hour 0. */
export function calendar(tick) {
  const hour = tick % TICKS_PER_DAY;
  const totalDays = Math.floor(tick / TICKS_PER_DAY);
  const day = (totalDays % DAYS_PER_MONTH) + 1;
  const totalMonths = Math.floor(totalDays / DAYS_PER_MONTH);
  const month = (totalMonths % MONTHS_PER_YEAR) + 1;
  const year = Math.floor(totalMonths / MONTHS_PER_YEAR) + 1;
  return { hour, day, month, year };
}

export function isValidSpeed(n) {
  return Number.isInteger(n) && n >= 0 && n <= 3;
}

/**
 * How many ticks to run for `dtMs` of real time. Mutates clock.acc.
 * Backlog is capped at one real second of ticks at the current speed.
 */
export function ticksForElapsed(clock, dtMs) {
  if (clock.speed === 0) {
    clock.acc = 0;
    return 0;
  }
  if (typeof dtMs !== 'number' || !Number.isFinite(dtMs) || dtMs <= 0) return 0;
  const tps = TICKS_PER_SECOND[clock.speed];
  clock.acc += (dtMs / 1000) * tps;
  if (clock.acc > tps) clock.acc = tps;
  const n = Math.floor(clock.acc);
  clock.acc -= n;
  return n;
}
