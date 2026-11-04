import { describe, it, expect } from 'vitest';
import { roadMask, roadPiece, N, E, S, W } from '../../src/ui/render/roadPieces.js';

function grid(rows) {
  const set = new Set();
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && set.add(`${x},${y}`)));
  return (x, y) => set.has(`${x},${y}`);
}

describe('road pieces', () => {
  it('computes neighbour masks', () => {
    const has = grid([
      '.#.',
      '###',
      '.#.',
    ]);
    expect(roadMask(1, 1, has)).toBe(N | E | S | W);
    expect(roadMask(0, 1, has)).toBe(E);
    expect(roadMask(1, 0, has)).toBe(S);
  });

  it('classifies every mask', () => {
    expect(roadPiece(0).kind).toBe('isolated');
    for (const m of [N, E, S, W]) expect(roadPiece(m).kind).toBe('deadend');
    expect(roadPiece(N | S).kind).toBe('straight');
    expect(roadPiece(E | W).kind).toBe('straight');
    for (const m of [N | E, E | S, S | W, W | N]) expect(roadPiece(m).kind).toBe('corner');
    for (const m of [N | E | S, E | S | W, S | W | N, W | N | E]) expect(roadPiece(m).kind).toBe('tee');
    expect(roadPiece(N | E | S | W).kind).toBe('cross');
  });

  it('lists arms in N,E,S,W order', () => {
    expect(roadPiece(W | E).arms).toEqual([E, W]);
    expect(roadPiece(S | N | W).arms).toEqual([N, S, W]);
  });

  it('builds the right pieces along an L-shaped road with a branch', () => {
    const has = grid([
      '####',
      '...#',
      '..##',
      '...#',
    ]);
    expect(roadPiece(roadMask(0, 0, has)).kind).toBe('deadend');
    expect(roadPiece(roadMask(1, 0, has)).kind).toBe('straight');
    expect(roadPiece(roadMask(3, 0, has)).kind).toBe('corner');
    expect(roadPiece(roadMask(3, 2, has)).kind).toBe('tee');
    expect(roadPiece(roadMask(2, 2, has)).kind).toBe('deadend');
  });
});
