// Touch gesture recogniser. Pure: feed it pointer positions (canvas pixels),
// it returns intents. The GameController decides what each intent does for
// the current tool. Mouse and pen input never go through here.
//
// One finger
//   down … up without moving more than TAP_SLOP            → tap
//   moves more than TAP_SLOP                                → dragStart, dragMove…, dragEnd on lift
// Two fingers (any tool)
//   a second finger arriving during a one-finger drag       → dragCancel (nothing is committed)
//   both fingers moving                                     → pinch { dx, dy, factor, cx, cy }
//   lifting back to one finger                              → that finger only pans (never builds)
//                                                             until every finger is up
import { panByScreen, zoomAt } from '../render/camera.js';

export const TAP_SLOP = 10; // px a finger may wander and still count as a tap

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * One pinch step from the previous to the current positions of two fingers.
 * dx/dy: movement of the midpoint; factor: change in finger spread;
 * cx/cy: the current midpoint (zoom anchor).
 */
export function pinchStep(p1, p2, q1, q2) {
  const pm = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const qm = { x: (q1.x + q2.x) / 2, y: (q1.y + q2.y) / 2 };
  const d0 = dist(p1, p2);
  const d1 = dist(q1, q2);
  const factor = d0 < 1 || d1 < 1 ? 1 : d1 / d0;
  return { dx: qm.x - pm.x, dy: qm.y - pm.y, factor, cx: qm.x, cy: qm.y };
}

/**
 * Apply a pinch step to a camera: pan with the midpoint, then zoom around the
 * new midpoint. The world point that was under the old midpoint ends up under
 * the new midpoint (until a zoom or map clamp kicks in).
 */
export function applyPinch(cam, vw, vh, step, bounds) {
  const panned = panByScreen(cam, step.dx, step.dy, bounds);
  if (step.factor === 1) return panned;
  return zoomAt(panned, vw, vh, step.cx, step.cy, step.factor, bounds);
}

export class TouchGestures {
  constructor({ slop = TAP_SLOP } = {}) {
    this.slop = slop;
    this.pts = new Map(); // id → {x, y}
    this.mode = 'idle'; // idle | pending | drag | multi | spent
    this.start = null;
  }

  get active() {
    return this.pts.size > 0;
  }

  down(id, x, y) {
    this.pts.set(id, { x, y });
    if (this.pts.size === 1) {
      this.mode = 'pending';
      this.start = { x, y };
      return [];
    }
    const out = [];
    if (this.mode === 'drag') out.push({ type: 'dragCancel' });
    this.mode = 'multi';
    return out;
  }

  move(id, x, y) {
    const prev = this.pts.get(id);
    if (!prev) return [];
    const cur = { x, y };
    if (this.mode === 'multi') {
      const ids = [...this.pts.keys()].slice(0, 2);
      if (!ids.includes(id)) {
        this.pts.set(id, cur);
        return [];
      }
      const before = ids.map((k) => this.pts.get(k));
      this.pts.set(id, cur);
      const after = ids.map((k) => this.pts.get(k));
      return [{ type: 'pinch', ...pinchStep(before[0], before[1], after[0], after[1]) }];
    }
    this.pts.set(id, cur);
    if (this.mode === 'spent') return [{ type: 'pan', dx: x - prev.x, dy: y - prev.y }];
    if (this.mode === 'pending') {
      if (dist(this.start, cur) <= this.slop) return [];
      this.mode = 'drag';
      return [{ type: 'dragStart', start: { ...this.start }, x, y, dx: x - this.start.x, dy: y - this.start.y }];
    }
    if (this.mode === 'drag') return [{ type: 'dragMove', x, y, dx: x - prev.x, dy: y - prev.y }];
    return [];
  }

  up(id, x, y) {
    return this.#release(id, x, y, false);
  }

  /** pointercancel: the browser took the touch away. Never commits. */
  cancel(id) {
    return this.#release(id, null, null, true);
  }

  /** Abandon the current gesture (on-screen Cancel). Fingers still down do nothing until lifted. */
  reset() {
    this.mode = this.pts.size ? 'spent' : 'idle';
  }

  #release(id, x, y, cancelled) {
    if (!this.pts.has(id)) return [];
    const last = this.pts.get(id);
    this.pts.delete(id);
    const px = x ?? last.x, py = y ?? last.y;
    const out = [];
    if (this.mode === 'pending' || this.mode === 'drag') {
      if (this.mode === 'drag') out.push(cancelled ? { type: 'dragCancel' } : { type: 'dragEnd', x: px, y: py });
      else if (!cancelled) out.push({ type: 'tap', x: px, y: py });
    }
    if (this.pts.size === 0) this.mode = 'idle';
    else if (this.pts.size === 1) this.mode = 'spent';
    else this.mode = 'multi';
    return out;
  }
}
