import { describe, it, expect } from 'vitest';
import { TouchGestures, TAP_SLOP, pinchStep, applyPinch } from '../../src/ui/input/gestures.js';
import { screenToWorld } from '../../src/ui/render/camera.js';

const types = (acts) => acts.map((a) => a.type);

describe('touch gestures: tap vs drag', () => {
  it('a still finger is a tap', () => {
    const g = new TouchGestures();
    expect(g.down(1, 100, 100)).toEqual([]);
    expect(g.up(1, 100, 100)).toEqual([{ type: 'tap', x: 100, y: 100 }]);
    expect(g.mode).toBe('idle');
  });

  it('wobble inside the slop is still a tap', () => {
    const g = new TouchGestures();
    g.down(1, 100, 100);
    expect(g.move(1, 100 + TAP_SLOP * 0.6, 100 + TAP_SLOP * 0.6)).toEqual([]);
    expect(types(g.up(1, 104, 103))).toEqual(['tap']);
  });

  it('moving past the slop starts a drag from the touch-down point and commits on lift', () => {
    const g = new TouchGestures();
    g.down(1, 100, 100);
    const [s] = g.move(1, 100 + TAP_SLOP + 1, 100);
    expect(s.type).toBe('dragStart');
    expect(s.start).toEqual({ x: 100, y: 100 });
    expect(s.dx).toBe(TAP_SLOP + 1);
    const [m] = g.move(1, 140, 120);
    expect(m).toMatchObject({ type: 'dragMove', x: 140, y: 120, dx: 140 - (100 + TAP_SLOP + 1), dy: 20 });
    expect(g.up(1, 140, 120)).toEqual([{ type: 'dragEnd', x: 140, y: 120 }]);
  });

  it('a drag never also produces a tap', () => {
    const g = new TouchGestures();
    g.down(1, 0, 0);
    g.move(1, 50, 0);
    g.move(1, 0, 0); // back to the start
    expect(types(g.up(1, 0, 0))).toEqual(['dragEnd']);
  });
});

describe('touch gestures: second finger', () => {
  it('cancels an in-progress one-finger drag with no dragEnd afterwards', () => {
    const g = new TouchGestures();
    g.down(1, 100, 100);
    g.move(1, 160, 100);
    expect(types(g.down(2, 300, 300))).toEqual(['dragCancel']);
    g.move(2, 320, 320);
    expect(g.up(1, 160, 100)).toEqual([]);
    expect(g.up(2, 320, 320)).toEqual([]);
    expect(g.mode).toBe('idle');
  });

  it('a second finger during a pending tap cancels the tap', () => {
    const g = new TouchGestures();
    g.down(1, 100, 100);
    expect(g.down(2, 200, 100)).toEqual([]);
    expect(g.up(2, 200, 100)).toEqual([]);
    expect(g.up(1, 100, 100)).toEqual([]);
  });

  it('two fingers pinch; the finger left behind only pans', () => {
    const g = new TouchGestures();
    g.down(1, 100, 100);
    g.down(2, 200, 100);
    const [p] = g.move(2, 300, 100);
    expect(p.type).toBe('pinch');
    expect(p.factor).toBeCloseTo(2);
    expect(p.cx).toBe(200);
    g.up(2, 300, 100);
    expect(g.move(1, 110, 90)).toEqual([{ type: 'pan', dx: 10, dy: -10 }]);
    expect(g.up(1, 110, 90)).toEqual([]);
  });

  it('pointercancel never commits', () => {
    const g = new TouchGestures();
    g.down(1, 0, 0);
    g.move(1, 80, 0);
    expect(types(g.cancel(1))).toEqual(['dragCancel']);
    g.down(3, 0, 0);
    expect(g.cancel(3)).toEqual([]);
  });

  it('reset (on-screen Cancel) swallows the rest of the gesture', () => {
    const g = new TouchGestures();
    g.down(1, 0, 0);
    g.move(1, 80, 0);
    g.reset();
    expect(types(g.move(1, 90, 0))).toEqual(['pan']);
    expect(g.up(1, 90, 0)).toEqual([]);
  });

  it('ignores pointers it never saw go down', () => {
    const g = new TouchGestures();
    expect(g.move(9, 1, 1)).toEqual([]);
    expect(g.up(9, 1, 1)).toEqual([]);
  });
});

describe('pinch math', () => {
  it('computes midpoint movement and spread factor', () => {
    const s = pinchStep({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 10, y: 20 }, { x: 160, y: 20 });
    expect(s.dx).toBe(35);
    expect(s.dy).toBe(20);
    expect(s.factor).toBeCloseTo(1.5);
    expect(s.cx).toBe(85);
    expect(s.cy).toBe(20);
  });

  it('degenerate spread does not zoom', () => {
    expect(pinchStep({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 6, y: 5 }, { x: 9, y: 5 }).factor).toBe(1);
  });

  it('keeps the world point under the pinch midpoint under the fingers', () => {
    const cam = { x: 200, y: 300, zoom: 1 };
    const vw = 390, vh = 844;
    const p1 = { x: 120, y: 400 }, p2 = { x: 260, y: 460 };
    const q1 = { x: 90, y: 380 }, q2 = { x: 330, y: 520 };
    const before = screenToWorld(cam, vw, vh, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
    const step = pinchStep(p1, p2, q1, q2);
    const next = applyPinch(cam, vw, vh, step);
    const after = screenToWorld(next, vw, vh, step.cx, step.cy);
    expect(next.zoom).toBeCloseTo(step.factor);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('respects zoom and map clamps', () => {
    const bounds = { minX: -100, maxX: 100, minY: 0, maxY: 100 };
    const next = applyPinch({ x: 0, y: 50, zoom: 2.8 }, 390, 844, { dx: 5000, dy: 0, factor: 3, cx: 195, cy: 422 }, bounds);
    expect(next.zoom).toBe(3);
    expect(next.x).toBeGreaterThanOrEqual(-100);
    expect(next.x).toBeLessThanOrEqual(100);
  });
});
