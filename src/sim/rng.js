// Seeded deterministic RNG (sfc32) with a serialisable 4×uint32 state.

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

export class Rng {
  /** @param {number[]} state four uint32 values */
  constructor(state) {
    this.a = state[0] >>> 0;
    this.b = state[1] >>> 0;
    this.c = state[2] >>> 0;
    this.d = state[3] >>> 0;
  }

  /** Build an RNG from any number or string seed (plus optional stream label). */
  static fromSeed(seed, stream = '') {
    const h = xmur3(String(seed) + '|' + stream);
    const rng = new Rng([h(), h(), h(), h()]);
    for (let i = 0; i < 12; i++) rng.nextUint32(); // warm up
    return rng;
  }

  static isValidState(state) {
    return (
      Array.isArray(state) &&
      state.length === 4 &&
      state.every((v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff)
    );
  }

  nextUint32() {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = (this.b ^ (this.b >>> 9)) >>> 0;
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** Float in [0, 1). */
  next() {
    return this.nextUint32() / 4294967296;
  }

  /** Integer in [0, n). */
  int(n) {
    return Math.floor(this.next() * n);
  }

  getState() {
    return [this.a, this.b, this.c, this.d];
  }
}
