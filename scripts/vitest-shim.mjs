// Minimal dev-only stand-in for the parts of Vitest that tests/sim uses.
// Loaded by scripts/run-sim-tests.mjs, which aliases the 'vitest' specifier
// to this file. Vitest itself is the primary runner (`npm test`).

import { isDeepStrictEqual, inspect } from 'node:util';

const root = { name: '', tests: [], children: [], beforeEach: [], afterEach: [], skip: false, parent: null };
let current = root;

function addSuite(name, fn, skip = false) {
  const suite = { name, tests: [], children: [], beforeEach: [], afterEach: [], skip, parent: current };
  current.children.push(suite);
  const prev = current;
  current = suite;
  try {
    fn();
  } finally {
    current = prev;
  }
}

export function describe(name, fn) {
  addSuite(name, fn);
}
describe.skip = (name, fn) => addSuite(name, fn, true);

export function it(name, fn) {
  current.tests.push({ name, fn, skip: false });
}
it.skip = (name, fn) => current.tests.push({ name, fn, skip: true });
export const test = it;

export function beforeEach(fn) {
  current.beforeEach.push(fn);
}
export function afterEach(fn) {
  current.afterEach.push(fn);
}

// ---------- expect ----------

class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssertionError';
  }
}

const fmt = (v) => inspect(v, { depth: 4, breakLength: 120 });

/** Vitest's toEqual ignores properties whose value is undefined. */
function stripUndefined(v, seen = new Map()) {
  if (v === null || typeof v !== 'object') return v;
  if (ArrayBuffer.isView(v) || v instanceof Date || v instanceof RegExp) return v;
  if (seen.has(v)) return seen.get(v);
  if (Array.isArray(v)) {
    const out = [];
    seen.set(v, out);
    for (const x of v) out.push(stripUndefined(x, seen));
    return out;
  }
  if (v instanceof Map || v instanceof Set) return v;
  const out = {};
  seen.set(v, out);
  for (const k of Object.keys(v)) if (v[k] !== undefined) out[k] = stripUndefined(v[k], seen);
  return out;
}

function errorMatches(err, expected) {
  if (expected === undefined) return true;
  const msg = err && err.message !== undefined ? String(err.message) : String(err);
  if (typeof expected === 'string') return msg.includes(expected);
  if (expected instanceof RegExp) return expected.test(msg);
  if (typeof expected === 'function') return err instanceof expected;
  if (expected && typeof expected === 'object' && 'message' in expected) return msg === expected.message;
  return false;
}

function makeMatchers(actual, negate) {
  const check = (pass, msg) => {
    if (pass === negate) throw new AssertionError((negate ? 'Expected NOT: ' : 'Expected: ') + msg);
  };
  return {
    toBe: (e) => check(Object.is(actual, e), `${fmt(actual)} to be ${fmt(e)}`),
    toEqual: (e) => check(isDeepStrictEqual(stripUndefined(actual), stripUndefined(e)), `${fmt(actual)} to equal ${fmt(e)}`),
    toStrictEqual: (e) => check(isDeepStrictEqual(actual, e), `${fmt(actual)} to strictly equal ${fmt(e)}`),
    toBeTruthy: () => check(!!actual, `${fmt(actual)} to be truthy`),
    toBeFalsy: () => check(!actual, `${fmt(actual)} to be falsy`),
    toBeNull: () => check(actual === null, `${fmt(actual)} to be null`),
    toBeUndefined: () => check(actual === undefined, `${fmt(actual)} to be undefined`),
    toBeDefined: () => check(actual !== undefined, `${fmt(actual)} to be defined`),
    toBeGreaterThan: (n) => check(actual > n, `${fmt(actual)} > ${fmt(n)}`),
    toBeGreaterThanOrEqual: (n) => check(actual >= n, `${fmt(actual)} >= ${fmt(n)}`),
    toBeLessThan: (n) => check(actual < n, `${fmt(actual)} < ${fmt(n)}`),
    toBeLessThanOrEqual: (n) => check(actual <= n, `${fmt(actual)} <= ${fmt(n)}`),
    toBeCloseTo: (n, digits = 2) => check(Math.abs(actual - n) < Math.pow(10, -digits) / 2, `${fmt(actual)} to be close to ${fmt(n)} (${digits} digits)`),
    toBeInstanceOf: (C) => check(actual instanceof C, `${fmt(actual)} to be instance of ${C && C.name}`),
    toHaveLength: (n) => check(actual != null && actual.length === n, `length ${actual == null ? actual : actual.length} to be ${n}`),
    toContain: (item) => {
      const has = typeof actual === 'string' ? actual.includes(item) : Array.from(actual).includes(item);
      check(has, `${fmt(actual)} to contain ${fmt(item)}`);
    },
    toThrow: (expected) => {
      if (typeof actual !== 'function') throw new AssertionError('toThrow expects a function');
      let threw = false;
      let err;
      try {
        actual();
      } catch (e) {
        threw = true;
        err = e;
      }
      const pass = threw && errorMatches(err, expected);
      check(pass, `function to throw${expected !== undefined ? ' ' + fmt(expected) : ''}${threw ? ` (threw ${fmt(err && err.message)})` : ' (did not throw)'}`);
    },
  };
}

function makeAsyncMatchers(promise, mode) {
  return new Proxy(
    {},
    {
      get(_, name) {
        return async (...args) => {
          let value;
          let rejected = false;
          try {
            value = await promise;
          } catch (e) {
            rejected = true;
            value = e;
          }
          if (mode === 'rejects' && !rejected) throw new AssertionError(`Expected promise to reject, it resolved with ${fmt(value)}`);
          if (mode === 'resolves' && rejected) throw new AssertionError(`Expected promise to resolve, it rejected with ${fmt(value)}`);
          if (name === 'toThrow' && mode === 'rejects') {
            const pass = errorMatches(value, args[0]);
            if (!pass) throw new AssertionError(`Expected rejection matching ${fmt(args[0])}, got ${fmt(value && value.message)}`);
            return;
          }
          const m = makeMatchers(value, false);
          if (!m[name]) throw new Error(`vitest-shim: unsupported matcher ${String(name)}`);
          return m[name](...args);
        };
      },
    },
  );
}

export function expect(actual) {
  const m = makeMatchers(actual, false);
  m.not = makeMatchers(actual, true);
  Object.defineProperty(m, 'rejects', { get: () => makeAsyncMatchers(actual, 'rejects') });
  Object.defineProperty(m, 'resolves', { get: () => makeAsyncMatchers(actual, 'resolves') });
  return m;
}

// ---------- runner ----------

function collectHooks(suite, key) {
  const chain = [];
  for (let s = suite; s; s = s.parent) chain.unshift(...s[key].map((h) => h));
  return key === 'afterEach' ? chain.reverse() : chain;
}

/** Run every test registered so far, then clear the registry. */
export async function runCollected({ file, log = console.log } = {}) {
  const result = { passed: 0, failed: 0, skipped: 0, failures: [] };
  async function runSuite(suite, path, skipped) {
    const skip = skipped || suite.skip;
    for (const t of suite.tests) {
      const name = [...path, t.name].join(' > ');
      if (skip || t.skip) {
        result.skipped++;
        log(`  - ${name} (skipped)`);
        continue;
      }
      const start = performance.now();
      try {
        for (const h of collectHooks(suite, 'beforeEach')) await h();
        await t.fn();
        for (const h of collectHooks(suite, 'afterEach')) await h();
        result.passed++;
        log(`  ✓ ${name} (${(performance.now() - start).toFixed(0)}ms)`);
      } catch (err) {
        result.failed++;
        result.failures.push({ file, name, err });
        log(`  ✗ ${name}\n      ${String((err && err.stack) || err).split('\n').slice(0, 6).join('\n      ')}`);
      }
    }
    for (const c of suite.children) await runSuite(c, [...path, c.name], skip);
  }
  await runSuite(root, [], false);
  root.tests = [];
  root.children = [];
  root.beforeEach = [];
  root.afterEach = [];
  return result;
}
