// Road piece selection from orthogonal neighbours. Pure.
//
// Bitmask: N=1 (y−1), E=2 (x+1), S=4 (y+1), W=8 (x−1).
// On screen with our projection, N points up-left, E up-right, S down-right,
// W down-left (each toward a diamond edge midpoint).

export const N = 1, E = 2, S = 4, W = 8;

export const DIRS = [
  { bit: N, dx: 0, dy: -1 },
  { bit: E, dx: 1, dy: 0 },
  { bit: S, dx: 0, dy: 1 },
  { bit: W, dx: -1, dy: 0 },
];

/** hasRoad(x, y) → boolean. Returns the neighbour bitmask for (x, y). */
export function roadMask(x, y, hasRoad) {
  let m = 0;
  for (const d of DIRS) if (hasRoad(x + d.dx, y + d.dy)) m |= d.bit;
  return m;
}

function bitCount(m) {
  return (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
}

/**
 * Classify a mask into a piece:
 *   { kind: 'isolated'|'deadend'|'straight'|'corner'|'tee'|'cross', arms: [bits…] }
 * `arms` lists the directions the road leaves the tile through. A dead end has
 * one arm; an isolated tile has none (drawn as a short stub/plaza).
 */
export function roadPiece(mask) {
  const arms = DIRS.filter((d) => mask & d.bit).map((d) => d.bit);
  const n = bitCount(mask);
  let kind;
  if (n === 0) kind = 'isolated';
  else if (n === 1) kind = 'deadend';
  else if (n === 2) kind = mask === (N | S) || mask === (E | W) ? 'straight' : 'corner';
  else if (n === 3) kind = 'tee';
  else kind = 'cross';
  return { kind, arms, mask };
}
