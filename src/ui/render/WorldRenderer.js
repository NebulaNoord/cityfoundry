// PixiJS world renderer.
//
// Layers (inside `world`, which carries the camera transform):
//   ground   – per-chunk Graphics: terrain, zone tint, roads, building lots
//   access   – per-chunk Graphics: "no road access" shading (zone tools only)
//   shadows  – per-chunk Graphics: building ground shadows
//   objects  – per-chunk Graphics: buildings, depth-sorted inside the chunk;
//              chunk containers are ordered by (cx+cy, cx) so overlap across
//              chunk borders is painted back-to-front as well
//   overlay  – hover / selection / tool ghosts, redrawn on demand
//
// Caching: a chunk is rebuilt only when sim.getChunkVersion(cx,cy) differs
// from the version it was built at. Off-screen chunks are hidden (culled) and
// not rebuilt until they come into view. Rebuilds are budgeted per frame.
import { Application, Container, Graphics } from 'pixi.js';
import { TILE_H, mapBounds, visibleTileRange, tileDiamond } from './iso.js';
import { viewRect } from './camera.js';
import { makeTileGrid, drawTerrain, drawRoads, drawZones, drawBuildings, drawAccess, ROAD_HALF } from './chunkArt.js';
import { P, rectPoly } from './draw.js';
import { WORLD, ZONE } from './palette.js';

const REBUILD_BUDGET_MS = 8;

export class WorldRenderer {
  /** Use WorldRenderer.create(); the constructor expects an initialised app. */
  constructor(app, sim) {
    this.app = app;
    this.sim = sim;
    const w = sim.getWorld();
    this.width = w.width;
    this.height = w.height;
    this.cs = w.chunkSize;
    this.chunksX = Math.ceil(w.width / this.cs);
    this.chunksY = Math.ceil(w.height / this.cs);
    this.bounds = mapBounds(w.width, w.height);
    this.showAccess = false;
    this.stats = { rebuilt: 0, visibleChunks: 0, frameMs: 0 };

    this.world = new Container();
    this.ground = new Container({ isRenderGroup: true });
    this.access = new Container({ isRenderGroup: true });
    this.shadows = new Container({ isRenderGroup: true });
    this.objects = new Container({ isRenderGroup: true });
    this.overlay = new Container();
    this.edge = new Graphics();
    this.world.addChild(this.edge, this.ground, this.access, this.shadows, this.objects, this.overlay);
    app.stage.addChild(this.world);
    this.drawMapEdge();

    this.chunks = [];
    const order = [];
    for (let cy = 0; cy < this.chunksY; cy++) {
      for (let cx = 0; cx < this.chunksX; cx++) order.push({ cx, cy });
    }
    order.sort((a, b) => a.cx + a.cy - (b.cx + b.cy) || a.cx - b.cx);
    for (const { cx, cy } of order) {
      const c = {
        cx, cy,
        x0: cx * this.cs, y0: cy * this.cs,
        x1: Math.min(this.width, (cx + 1) * this.cs) - 1,
        y1: Math.min(this.height, (cy + 1) * this.cs) - 1,
        version: -1, accessVersion: -1,
        ground: new Graphics(), access: new Graphics(), shadow: new Graphics(), obj: new Graphics(),
        visible: false,
      };
      for (const k of ['ground', 'access', 'shadow', 'obj']) c[k].visible = false;
      this.ground.addChild(c.ground);
      this.access.addChild(c.access);
      this.shadows.addChild(c.shadow);
      this.objects.addChild(c.obj);
      this.chunks[cy * this.chunksX + cx] = c;
    }

    this.overlayG = new Graphics();
    this.overlay.addChild(this.overlayG);
    this.overlayDirty = true;
    this.overlayState = null;
  }

  static async create(canvasParent, sim) {
    const app = new Application();
    await app.init({
      resizeTo: canvasParent,
      background: WORLD.bg,
      antialias: true,
      autoStart: false, // the game loop calls render() itself
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: 'webgl',
      powerPreference: 'high-performance',
    });
    app.ticker.stop();
    app.canvas.setAttribute('aria-label', 'City map');
    app.canvas.setAttribute('data-testid', 'map-canvas');
    canvasParent.appendChild(app.canvas);
    return new WorldRenderer(app, sim);
  }

  get viewW() {
    return this.app.renderer.width / this.app.renderer.resolution;
  }

  get viewH() {
    return this.app.renderer.height / this.app.renderer.resolution;
  }

  drawMapEdge() {
    // Concrete slab sides under the map so the world reads as a model on a table.
    const g = this.edge;
    const w = this.width, h = this.height;
    const d = 18;
    g.poly([...P(0, h), ...P(w, h), ...P(w, h, -d), ...P(0, h, -d)], true).fill(WORLD.slabSide);
    g.poly([...P(w, 0), ...P(w, h), ...P(w, h, -d), ...P(w, 0, -d)], true).fill(WORLD.slabSideDark);
    g.poly([...P(0, h), ...P(w, h)], false).stroke({ width: 1, color: WORLD.slabEdge, alpha: 0.6 });
    g.poly([...P(w, 0), ...P(w, h)], false).stroke({ width: 1, color: WORLD.slabEdge, alpha: 0.45 });
  }

  setAccessOverlay(on) {
    if (this.showAccess === on) return;
    this.showAccess = on;
    this.access.visible = on;
  }

  // ------------------------------------------------------------ chunk cache
  rebuildChunk(c) {
    const sim = this.sim;
    const tiles = sim.getTilesInRect(c.x0 - 1, c.y0 - 1, c.x1 + 1, c.y1 + 1);
    const at = makeTileGrid(tiles, c.x0 - 1, c.y0 - 1, c.x1 + 1, c.y1 + 1);
    const cache = new Map();
    const getBuilding = (id) => {
      if (!cache.has(id)) cache.set(id, sim.getBuilding(id));
      return cache.get(id);
    };
    c.ground.clear();
    c.shadow.clear();
    c.obj.clear();
    drawTerrain(c.ground, at, c.x0, c.y0, c.x1, c.y1);
    drawZones(c.ground, at, c.x0, c.y0, c.x1, c.y1);
    drawRoads(c.ground, at, c.x0, c.y0, c.x1, c.y1);
    drawBuildings(c.ground, c.shadow, c.obj, at, c.x0, c.y0, c.x1, c.y1, getBuilding);
    c.tiles = at;
    if (this.showAccess) this.rebuildAccess(c, at);
    else c.accessVersion = -1;
  }

  rebuildAccess(c, at) {
    c.access.clear();
    drawAccess(c.access, at, c.x0, c.y0, c.x1, c.y1);
  }

  /** Update visibility and rebuild stale visible chunks. */
  updateChunks(cam) {
    const view = viewRect(cam, this.viewW, this.viewH);
    // Buildings rise up to ~50px above their tile: extend the view downward.
    const range = visibleTileRange({ ...view, maxY: view.maxY + 64 }, this.width, this.height, 1);
    const cx0 = Math.floor(range.x0 / this.cs), cx1 = Math.floor(range.x1 / this.cs);
    const cy0 = Math.floor(range.y0 / this.cs), cy1 = Math.floor(range.y1 / this.cs);
    const t0 = performance.now();
    let visible = 0;
    let rebuilt = 0;
    const stale = [];
    for (const c of this.chunks) {
      let on = c.cx >= cx0 && c.cx <= cx1 && c.cy >= cy0 && c.cy <= cy1;
      if (on) {
        // precise test: chunk diamond bounds vs view
        const b = chunkBounds(c);
        on = b.maxX >= view.minX && b.minX <= view.maxX && b.maxY >= view.minY - 64 && b.minY <= view.maxY + 64;
      }
      if (on !== c.visible) {
        c.visible = on;
        c.ground.visible = c.shadow.visible = c.obj.visible = c.access.visible = on;
      }
      if (!on) continue;
      visible++;
      const v = this.sim.getChunkVersion(c.cx, c.cy);
      if (v !== c.version || (this.showAccess && c.accessVersion !== v)) stale.push({ c, v });
    }
    // Rebuild nearest-to-centre first, within a time budget (always at least one).
    if (stale.length) {
      stale.sort((a, b) => dist2(a.c, cam) - dist2(b.c, cam));
      for (const { c, v } of stale) {
        if (rebuilt > 0 && performance.now() - t0 > REBUILD_BUDGET_MS) break;
        if (c.version !== v) {
          this.rebuildChunk(c);
          c.version = v;
        } else if (c.tiles) {
          this.rebuildAccess(c, c.tiles);
        }
        if (this.showAccess) c.accessVersion = v;
        rebuilt++;
      }
    }
    this.stats.visibleChunks = visible;
    this.stats.rebuilt += rebuilt;
    this.stats.pending = stale.length - rebuilt;
  }

  /** Invalidate every chunk (e.g. after WebGL context restore). */
  invalidateAll() {
    for (const c of this.chunks) {
      c.version = -1;
      c.accessVersion = -1;
    }
    this.overlayDirty = true;
  }

  // ---------------------------------------------------------------- overlay
  /**
   * state: {
   *   hover: {x,y}|null, selected: {x,y}|null,
   *   road: { path:[{x,y}], valid, type } | null,
   *   rect: { x0,y0,x1,y1, mode:'zone'|'bulldoze', zone, cells:[{x,y,ok}] } | null,
   *   tool
   * }
   */
  setOverlay(state) {
    this.overlayState = state;
    this.overlayDirty = true;
  }

  drawOverlay(time) {
    const s = this.overlayState;
    const g = this.overlayG;
    g.clear();
    if (!s) return;
    const pulse = 0.55 + 0.25 * Math.sin(time / 260);

    if (s.road && s.road.path.length) {
      const col = s.road.valid ? WORLD.ghostOk : WORLD.ghostBad;
      const hw = ROAD_HALF[s.road.type] ?? 0.3;
      for (const p of s.road.path) {
        g.poly(tileDiamond(p.x, p.y), true).fill({ color: col, alpha: 0.16 });
      }
      for (const p of s.road.path) {
        g.poly(rectPoly(p.x + 0.5 - hw, p.y + 0.5 - hw, p.x + 0.5 + hw, p.y + 0.5 + hw), true).fill({ color: col, alpha: 0.45 });
      }
      // centreline through the path
      const pts = s.road.path.map((p) => P(p.x + 0.5, p.y + 0.5));
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.stroke({ width: 2, color: col, alpha: 0.95 });
      const a = pts[0], b = pts[pts.length - 1];
      g.circle(a[0], a[1], 4).fill(col);
      g.circle(b[0], b[1], 4).fill(col);
    }

    if (s.rect) {
      const r = s.rect;
      const tint = r.mode === 'bulldoze' ? WORLD.ghostBad : r.zone ? ZONE[r.zone] : 0xd8d4c8;
      for (const c of r.cells) {
        if (c.ok) g.poly(tileDiamond(c.x, c.y), true).fill({ color: tint, alpha: 0.42 });
        else {
          g.poly(tileDiamond(c.x, c.y), true).fill({ color: WORLD.ghostBad, alpha: 0.16 });
          const [x0, y0] = P(c.x + 0.3, c.y + 0.3), [x1, y1] = P(c.x + 0.7, c.y + 0.7);
          const [x2, y2] = P(c.x + 0.7, c.y + 0.3), [x3, y3] = P(c.x + 0.3, c.y + 0.7);
          g.moveTo(x0, y0).lineTo(x1, y1).moveTo(x2, y2).lineTo(x3, y3);
        }
      }
      g.stroke({ width: 1.2, color: WORLD.ghostBad, alpha: 0.8 });
      g.poly(rectPoly(r.x0, r.y0, r.x1 + 1, r.y1 + 1), true).stroke({ width: 1.5, color: tint, alpha: 0.95 });
    }

    if (s.selected) {
      g.poly(tileDiamond(s.selected.x, s.selected.y), true).stroke({ width: 2, color: WORLD.select, alpha: 0.95 });
      const [cx, cy] = P(s.selected.x + 0.5, s.selected.y + 0.5);
      g.moveTo(cx, cy - 8).lineTo(cx, cy - 40).stroke({ width: 1, color: WORLD.select, alpha: 0.7 });
      g.circle(cx, cy - 40, 3).fill(WORLD.select);
    }

    if (s.hover && !s.road && !s.rect) {
      const col = s.tool === 'bulldoze' ? WORLD.ghostBad : WORLD.hover;
      const d = tileDiamond(s.hover.x, s.hover.y);
      g.poly(d, true).fill({ color: col, alpha: 0.18 * pulse + 0.06 });
      g.poly(d, true).stroke({ width: 1.5, color: col, alpha: 0.95 });
    }
  }

  // ------------------------------------------------------------------ frame
  render(cam, time) {
    const t0 = performance.now();
    const vw = this.viewW, vh = this.viewH;
    this.world.scale.set(cam.zoom);
    this.world.position.set(Math.round(vw / 2 - cam.x * cam.zoom), Math.round(vh / 2 - cam.y * cam.zoom));
    this.updateChunks(cam);
    // overlay is cheap; redraw every frame when something animates (hover pulse)
    if (this.overlayDirty || (this.overlayState && this.overlayState.hover)) {
      this.drawOverlay(time);
      this.overlayDirty = false;
    }
    this.app.render();
    this.stats.frameMs = performance.now() - t0;
  }

  destroy() {
    try {
      this.app.destroy(true, { children: true });
    } catch {
      /* already gone */
    }
  }
}

function chunkBounds(c) {
  const left = P(c.x0, c.y1 + 1), right = P(c.x1 + 1, c.y0);
  const top = P(c.x0, c.y0), bottom = P(c.x1 + 1, c.y1 + 1);
  return { minX: left[0], maxX: right[0], minY: top[1] - 60, maxY: bottom[1] + TILE_H };
}

function dist2(c, cam) {
  const [x, y] = P((c.x0 + c.x1 + 1) / 2, (c.y0 + c.y1 + 1) / 2);
  return (x - cam.x) ** 2 + (y - cam.y) ** 2;
}
