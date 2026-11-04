// Owns one running city: the sim, the PixiJS renderer, the camera, input and
// the single requestAnimationFrame loop. React talks to it through methods;
// it publishes throttled snapshots to the Zustand store (never per frame).
import { WorldRenderer } from '../render/WorldRenderer.js';
import { pickTile, tileCenter } from '../render/iso.js';
import { clampCamera, zoomAt, panByScreen, screenToWorld } from '../render/camera.js';
import { useGame } from '../store.js';
import { TOOLS, toolForKey, isZoneTool, zoneForTool, normRect, cellsInRect, zoneBlockReason, errorText } from '../tools.js';
import { formatMoney } from '../format.js';
import { saveCity, AUTOSAVE_SLOT } from '../../sim/storage.js';
import { slotForWorld } from '../slots.js';

export { slotForWorld };

const KEY_PAN_SPEED = 900; // screen px per second
const ZOOM_STEP = 1.2;
const MAX_RECT_CELLS = 4096;

export class GameController {
  constructor(sim) {
    this.sim = sim;
    this.world = sim.getWorld();
    this.slot = slotForWorld(this.world);
    this.renderer = null;
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.keys = new Set();
    this.drag = null; // { kind: 'pan'|'tool', ... }
    this.spaceHeld = false;
    this.spacePanned = false;
    this.pointer = null; // last pointer position in canvas px
    this.unsubs = [];
    this.running = false;
    this.lastFrame = 0;
    this.lastHoverKey = '';
    this.glLost = false;
    this.saving = null;
  }

  // ------------------------------------------------------------- lifecycle
  async mount(host) {
    this.host = host;
    this.renderer = await WorldRenderer.create(host, this.sim);
    if (this.destroyed) {
      this.renderer.destroy();
      return;
    }
    this.canvas = this.renderer.app.canvas;
    const o = this.world.outsideConnection;
    const c = tileCenter(o.x + 12, o.y);
    this.cam = clampCamera({ x: c.x, y: c.y, zoom: 1.25 }, this.renderer.bounds);
    this.bindSim();
    this.bindInput();
    this.publishAll();
    this.running = true;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    this.destroyed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    for (const off of this.unsubs) off();
    this.unsubs = [];
    if (this.renderer) this.renderer.destroy();
    this.renderer = null;
  }

  frame = (now) => {
    if (!this.running) return;
    const dt = Math.min(1000, now - this.lastFrame);
    this.lastFrame = now;
    try {
      this.sim.update(dt);
      this.applyKeyPan(dt);
      if (!this.glLost) this.renderer.render(this.cam);
    } catch (err) {
      console.error('[cityfoundry] frame failed', err);
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  // ---------------------------------------------------------- sim → store
  bindSim() {
    const sim = this.sim;
    const set = useGame.setState;
    this.unsubs.push(
      sim.on('statsChanged', ({ stats }) => set({ stats })),
      sim.on('day', ({ day }) => {
        set({ time: sim.getTime() });
        this.refreshInspect();
        if (day === 1) this.save(AUTOSAVE_SLOT, { quiet: true });
      }),
      sim.on('notification', (n) => {
        // Stamp with the sim's own calendar at arrival time (the payload has no date).
        useGame.getState().addNotification({ ...n, time: sim.getTime() });
      }),
      sim.on('tilesChanged', ({ cells }) => {
        const sel = useGame.getState().selected;
        if (sel && cells.some((c) => c.x === sel.x && c.y === sel.y)) this.refreshInspect();
        if (this.drag && this.drag.kind === 'tool') this.updateToolPreview(true);
      }),
    );
    const onHide = () => {
      if (document.visibilityState === 'hidden') this.save(AUTOSAVE_SLOT, { quiet: true });
    };
    document.addEventListener('visibilitychange', onHide);
    this.unsubs.push(() => document.removeEventListener('visibilitychange', onHide));
  }

  publishAll() {
    const sim = this.sim;
    useGame.setState({
      stats: sim.getStats(),
      time: sim.getTime(),
      cityName: this.world.name,
      slot: this.slot,
      notifications: sim.getNotifications(20),
    });
    this.refreshInspect();
  }

  refreshInspect() {
    const sel = useGame.getState().selected;
    if (!sel) return useGame.setState({ inspect: null });
    const tile = this.sim.getTile(sel.x, sel.y);
    const building = tile && tile.buildingId != null ? this.sim.getBuilding(tile.buildingId) : null;
    useGame.setState({ inspect: { tile, building } });
  }

  // ---------------------------------------------------------------- commands
  setSpeed(n) {
    const r = this.sim.setSpeed(n);
    if (r.ok) {
      if (n > 0) this.lastSpeed = n;
      useGame.setState({ time: this.sim.getTime() });
    }
  }

  togglePause() {
    const { speed } = this.sim.getTime();
    this.setSpeed(speed === 0 ? this.lastSpeed || 1 : 0);
  }

  setTaxRate(zone, pct) {
    const r = this.sim.setTaxRate(zone, pct);
    if (!r.ok) useGame.getState().showToast(errorText(r.error, r.message), 'bad');
  }

  async save(slot = this.slot, { quiet = false } = {}) {
    if (this.saving) return this.saving;
    if (!quiet) useGame.setState({ saveState: { status: 'saving', at: null, error: null } });
    this.saving = saveCity(slot, this.sim)
      .then((rec) => {
        if (!quiet) {
          useGame.setState({ saveState: { status: 'saved', at: rec.savedAt, error: null } });
          useGame.getState().showToast(`Saved ${rec.name}`, 'ok');
        }
        return rec;
      })
      .catch((err) => {
        console.warn('[cityfoundry] save failed', err);
        useGame.setState({ saveState: { status: 'error', at: null, error: String(err && err.message ? err.message : err) } });
        useGame.getState().showToast('Save failed. Your browser may be blocking storage.', 'bad');
        return null;
      })
      .finally(() => {
        this.saving = null;
      });
    return this.saving;
  }

  setTool(tool) {
    if (!TOOLS[tool]) return;
    const st = useGame.getState();
    if (tool === 'road' && st.tool === 'road') {
      st.setRoadType(st.roadType === 'street' ? 'avenue' : 'street');
    }
    this.cancelDrag();
    st.setTool(tool);
    if (this.renderer) this.renderer.setAccessOverlay(isZoneTool(tool));
    this.updateToolPreview(true);
  }

  // ---------------------------------------------------------------- camera
  viewport() {
    return { w: this.renderer.viewW, h: this.renderer.viewH };
  }

  zoomBy(factor, sx, sy) {
    if (!this.renderer) return;
    const { w, h } = this.viewport();
    this.cam = zoomAt(this.cam, w, h, sx ?? w / 2, sy ?? h / 2, factor, this.renderer.bounds);
    this.updateHoverFromPointer();
  }

  panBy(dx, dy) {
    this.cam = panByScreen(this.cam, dx, dy, this.renderer.bounds);
  }

  centerOn(x, y) {
    const c = tileCenter(x, y);
    this.cam = clampCamera({ ...this.cam, x: c.x, y: c.y }, this.renderer.bounds);
  }

  applyKeyPan(dt) {
    if (!this.keys.size) return;
    let dx = 0, dy = 0;
    if (this.keys.has('left')) dx += 1;
    if (this.keys.has('right')) dx -= 1;
    if (this.keys.has('up')) dy += 1;
    if (this.keys.has('down')) dy -= 1;
    if (!dx && !dy) return;
    const s = (KEY_PAN_SPEED * dt) / 1000;
    this.panBy(dx * s, dy * s);
    this.updateHoverFromPointer();
  }

  /** Tile under a canvas-pixel position, or null outside the map. */
  tileAt(px, py) {
    const { w, h } = this.viewport();
    const wp = screenToWorld(this.cam, w, h, px, py);
    const t = pickTile(wp.x, wp.y);
    if (t.x < 0 || t.y < 0 || t.x >= this.world.width || t.y >= this.world.height) return null;
    return t;
  }

  // ---------------------------------------------------------------- input
  bindInput() {
    const cv = this.canvas;
    const on = (el, ev, fn, opts) => {
      el.addEventListener(ev, fn, opts);
      this.unsubs.push(() => el.removeEventListener(ev, fn, opts));
    };
    on(cv, 'pointerdown', this.onPointerDown);
    on(window, 'pointermove', this.onPointerMove);
    on(window, 'pointerup', this.onPointerUp);
    on(cv, 'pointerleave', this.onPointerLeave);
    on(cv, 'wheel', this.onWheel, { passive: false });
    on(cv, 'contextmenu', (e) => e.preventDefault());
    on(cv, 'auxclick', (e) => e.preventDefault());
    // A mouse click on a HUD button or slider must not keep keyboard focus there,
    // or Space would re-press the button and hotkeys would go to the slider.
    // Keyboard users (Tab) keep normal focus behaviour.
    on(window, 'pointerup', (e) => {
      const el = e.target && e.target.closest && e.target.closest('button, input[type=range]');
      if (el && e.pointerType !== '') setTimeout(() => el.blur(), 0);
    });
    on(window, 'keydown', this.onKeyDown);
    on(window, 'keyup', this.onKeyUp);
    on(window, 'blur', () => {
      this.keys.clear();
      this.spaceHeld = false;
    });
    on(cv, 'webglcontextlost', (e) => {
      e.preventDefault();
      this.glLost = true;
      useGame.setState({ glLost: true });
    });
    on(cv, 'webglcontextrestored', () => {
      this.glLost = false;
      this.renderer.invalidateAll();
      useGame.setState({ glLost: false });
    });
  }

  localPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onPointerDown = (e) => {
    const p = this.localPos(e);
    this.pointer = p;
    this.canvas.focus?.();
    if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) {
      document.activeElement.blur(); // return keyboard to the map
    }
    const panButton = e.button === 1 || e.button === 2 || (e.button === 0 && this.spaceHeld);
    if (panButton) {
      e.preventDefault();
      this.drag = { kind: 'pan', last: p };
      if (this.spaceHeld) this.spacePanned = true;
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    const t = this.tileAt(p.x, p.y);
    const tool = useGame.getState().tool;
    if (tool === 'inspect') {
      useGame.setState({ selected: t });
      this.refreshInspect();
      this.pushOverlay();
      return;
    }
    if (!t) return;
    this.drag = { kind: 'tool', tool, start: t, end: t };
    this.updateToolPreview(true);
  };

  onPointerMove = (e) => {
    if (!this.canvas) return;
    const p = this.localPos(e);
    const inside = e.target === this.canvas || (this.drag != null);
    if (this.drag && this.drag.kind === 'pan') {
      this.panBy(p.x - this.drag.last.x, p.y - this.drag.last.y);
      this.drag.last = p;
      this.pointer = p;
      return;
    }
    if (!inside) return;
    this.pointer = p;
    this.updateHoverFromPointer();
  };

  onPointerUp = (e) => {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    if (d.kind === 'pan') {
      this.canvas.style.cursor = '';
      return;
    }
    if (e.button !== 0) return;
    this.commitTool(d);
    this.updateToolPreview(true);
  };

  onPointerLeave = () => {
    if (this.drag) return;
    this.pointer = null;
    this.lastHoverKey = '';
    useGame.setState({ hover: null, hint: null });
    this.pushOverlay();
  };

  onWheel = (e) => {
    e.preventDefault();
    const p = this.localPos(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    const factor = Math.pow(1.0015, -dy);
    this.zoomBy(Math.min(1.6, Math.max(1 / 1.6, factor)), p.x, p.y);
  };

  onKeyDown = (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down', A: 'left', D: 'right', W: 'up', S: 'down' }[k];
    if (dir) {
      this.keys.add(dir);
      e.preventDefault();
      return;
    }
    if (k === ' ') {
      e.preventDefault();
      if (!e.repeat) {
        this.spaceHeld = true;
        this.spacePanned = false;
      }
      return;
    }
    if (k === 'Escape') {
      if (this.drag) this.cancelDrag();
      else if (useGame.getState().selected) {
        useGame.setState({ selected: null, inspect: null });
        this.pushOverlay();
      } else this.setTool('inspect');
      return;
    }
    if (k === '+' || k === '=') return this.zoomBy(ZOOM_STEP);
    if (k === '-' || k === '_') return this.zoomBy(1 / ZOOM_STEP);
    if (k === '0' || k === 'p' || k === 'P') return this.setSpeed(0);
    if (k === '1' || k === '2' || k === '3') return this.setSpeed(Number(k));
    if (e.repeat) return;
    const tool = toolForKey(k);
    if (tool) {
      e.preventDefault();
      this.setTool(tool);
    }
  };

  onKeyUp = (e) => {
    const k = e.key;
    const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down', A: 'left', D: 'right', W: 'up', S: 'down' }[k];
    if (dir) {
      this.keys.delete(dir);
      return;
    }
    if (k === ' ') {
      const tag = e.target && e.target.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON';
      if (this.spaceHeld && !this.spacePanned && !typing) this.togglePause();
      this.spaceHeld = false;
    }
  };

  cancelDrag() {
    if (this.drag && this.drag.kind === 'pan' && this.canvas) this.canvas.style.cursor = '';
    this.drag = null;
    useGame.setState({ hint: null });
    this.pushOverlay();
  }

  updateHoverFromPointer() {
    if (!this.pointer || !this.renderer) return;
    const t = this.tileAt(this.pointer.x, this.pointer.y);
    const key = t ? `${t.x},${t.y}` : '';
    if (key === this.lastHoverKey) {
      this.positionHint();
      return;
    }
    this.lastHoverKey = key;
    useGame.setState({ hover: t });
    if (this.drag && this.drag.kind === 'tool' && t) this.drag.end = t;
    this.updateToolPreview();
  }

  positionHint() {
    const h = useGame.getState().hint;
    if (h && this.pointer && (h.x !== this.pointer.x || h.y !== this.pointer.y)) {
      useGame.setState({ hint: { ...h, x: this.pointer.x, y: this.pointer.y } });
    }
  }

  // ------------------------------------------------------------- tool logic
  /** Recompute ghost previews and the cursor hint for the current state. */
  updateToolPreview() {
    if (!this.renderer) return;
    const st = useGame.getState();
    const tool = st.tool;
    const hover = st.hover;
    const p = this.pointer || { x: 0, y: 0 };
    const overlay = { tool, hover, selected: st.selected, road: null, rect: null };
    let hint = null;

    if (tool === 'road') {
      const from = this.drag && this.drag.kind === 'tool' ? this.drag.start : hover;
      const to = this.drag && this.drag.kind === 'tool' ? this.drag.end : hover;
      if (from && to) {
        const pv = this.sim.previewRoad(from, to, st.roadType);
        overlay.road = { path: pv.path, valid: pv.valid, type: st.roadType };
        const tiles = pv.path.length;
        hint = pv.valid
          ? { tone: 'ok', title: formatMoney(pv.cost), detail: `${tiles} tile${tiles === 1 ? '' : 's'} of ${st.roadType}` }
          : { tone: 'bad', title: errorText(pv.error, pv.message), detail: pv.cost ? `Cost ${formatMoney(pv.cost)}` : '' };
      }
    } else if (isZoneTool(tool) || tool === 'bulldoze') {
      const a = this.drag && this.drag.kind === 'tool' ? this.drag.start : hover;
      const b = this.drag && this.drag.kind === 'tool' ? this.drag.end : hover;
      const r = a && b ? normRect(a, b, this.world.width, this.world.height) : null;
      if (r && (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) <= MAX_RECT_CELLS) {
        const tiles = this.sim.getTilesInRect(r.x0, r.y0, r.x1, r.y1);
        let okCount = 0;
        let firstReason = null;
        const cells = tiles.map((t) => {
          let ok;
          if (tool === 'bulldoze') {
            ok = t.buildingId != null || (t.road && t.road.type !== 'highway') || t.zone != null;
          } else {
            // Dezone: any zoned tile. Zone brush: validity from the sim's tile fields.
            const reason = zoneForTool(tool) === null ? (t.zone ? null : 'Not zoned') : zoneBlockReason(t);
            ok = !reason;
            if (reason && !firstReason) firstReason = reason;
          }
          if (ok) okCount++;
          return { x: t.x, y: t.y, ok };
        });
        overlay.rect = { ...r, mode: tool === 'bulldoze' ? 'bulldoze' : 'zone', zone: zoneForTool(tool), cells };
        if (tool === 'bulldoze') {
          const only = tiles.length === 1 ? tiles[0] : null;
          if (only && only.road && only.road.type === 'highway') hint = { tone: 'bad', title: errorText('PROTECTED'), detail: '' };
          else if (this.drag) hint = { tone: okCount ? 'ok' : 'bad', title: okCount ? `Demolish ${okCount} tile${okCount === 1 ? '' : 's'}` : 'Nothing to demolish', detail: 'Bulldozing refunds nothing' };
        } else if (this.drag || firstReason) {
          const label = tool === 'dezone' ? 'Dezone' : `Zone ${TOOLS[tool].label.toLowerCase()}`;
          hint = okCount
            ? { tone: 'ok', title: `${label}: ${okCount} tile${okCount === 1 ? '' : 's'}`, detail: firstReason && okCount < tiles.length ? `Skips tiles: ${firstReason.toLowerCase()}` : 'Zoning is free' }
            : { tone: 'bad', title: firstReason || 'Nothing to change', detail: '' };
        }
      }
    }
    useGame.setState({ hint: hint && this.pointer ? { ...hint, x: p.x, y: p.y } : null });
    this.renderer.setOverlay(overlay);
  }

  pushOverlay() {
    this.updateToolPreview();
  }

  commitTool(d) {
    const st = useGame.getState();
    const toast = st.showToast;
    if (d.tool === 'road') {
      const r = this.sim.placeRoad(d.start, d.end, st.roadType);
      if (!r.ok) toast(errorText(r.error, r.message), 'bad');
      return;
    }
    const rect = normRect(d.start, d.end, this.world.width, this.world.height);
    if (!rect) return;
    const cells = cellsInRect(rect);
    if (d.tool === 'bulldoze') {
      const r = this.sim.bulldoze(cells);
      if (!r.ok) toast(errorText(r.error, r.message), 'bad');
      return;
    }
    if (isZoneTool(d.tool)) {
      const r = this.sim.paintZone(cells, zoneForTool(d.tool));
      if (!r.ok) toast(errorText(r.error, r.message), 'bad');
    }
  }
}
