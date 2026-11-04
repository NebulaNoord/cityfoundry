// Phone e2e: touch-only play in portrait and landscape.
//
// Every map interaction is a real touch sequence sent through the Chrome
// DevTools Protocol (Input.dispatchTouchEvent), which Chrome turns into
// pointer events with pointerType 'touch' — the same path a phone uses.
// window.__cityfoundry is only READ (tile positions on screen, sim tiles).
import { test, expect } from '@playwright/test';

const SEED = '4242';

function parseNumber(text) {
  return Number(String(text).replace(/[^0-9.\-−]/g, '').replace('−', '-'));
}

async function touchSession(page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 4, radiusY: 4, force: 1 })),
    });
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  return {
    async tap(p) {
      await send('touchStart', [p]);
      await page.waitForTimeout(30);
      await send('touchEnd', []);
    },
    /** One-finger drag. `beforeLift` runs with the finger still down. */
    async drag(a, b, { steps = 8, beforeLift } = {}) {
      await send('touchStart', [a]);
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', [lerp(a, b, i / steps)]);
        await page.waitForTimeout(16);
      }
      if (beforeLift) await beforeLift();
      await send('touchEnd', []);
      // Chrome drops the click of a tap that follows a synthetic drag within a
      // few frames; a real finger can't re-tap that fast. Let it settle.
      await page.waitForTimeout(300);
    },
    /** Two-finger gesture from (a1,a2) to (b1,b2). */
    async pinch(a1, a2, b1, b2, steps = 8) {
      await send('touchStart', [{ ...a1, id: 0 }, { ...a2, id: 1 }]);
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', [{ ...lerp(a1, b1, i / steps), id: 0 }, { ...lerp(a2, b2, i / steps), id: 1 }]);
        await page.waitForTimeout(16);
      }
      await send('touchEnd', []);
      await page.waitForTimeout(300);
    },
    /** Start a one-finger drag, then put a second finger down, then lift both. */
    async dragThenSecondFinger(a, b, extra) {
      await send('touchStart', [{ ...a, id: 0 }]);
      for (let i = 1; i <= 6; i++) {
        await send('touchMove', [{ ...lerp(a, b, i / 6), id: 0 }]);
        await page.waitForTimeout(16);
      }
      await send('touchStart', [{ ...b, id: 0 }, { ...extra, id: 1 }]);
      await send('touchMove', [{ x: b.x + 5, y: b.y, id: 0 }, { x: extra.x + 5, y: extra.y, id: 1 }]);
      await send('touchEnd', [{ x: b.x + 5, y: b.y, id: 0 }]);
      await send('touchEnd', []);
      await page.waitForTimeout(300);
    },
  };
}

async function tilePos(page, x, y) {
  const p = await page.evaluate(([x, y]) => window.__cityfoundry.tileToScreen(x, y), [x, y]);
  const box = await page.getByTestId('map-canvas').boundingBox();
  return { x: box.x + p.x, y: box.y + p.y };
}

/** Screen position of a tile, asserting a finger there would land on the map (not a HUD panel). */
async function tileXY(page, x, y) {
  const q = await tilePos(page, x, y);
  const onMap = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.dataset?.testid === 'map-canvas', [q.x, q.y]);
  if (!onMap) throw new Error(`tile ${x},${y} is not reachable on the map at ${Math.round(q.x)},${Math.round(q.y)}`);
  return q;
}

/** Tap a toolbar tool and confirm it is active. */
async function pickTool(page, id) {
  const btn = page.getByTestId(`tool-${id}`);
  // Under emulated touch Chrome occasionally swallows the click of a tap that
  // lands right after a synthetic drag (it is still deciding about a fling).
  // Retry the tap a few times; a lost tap only ever leaves the old tool active.
  await expect(async () => {
    if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.tap();
    await expect(btn).toHaveAttribute('aria-pressed', 'true', { timeout: 500 });
  }).toPass({ timeout: 5000 });
}

const camera = (page) => page.evaluate(() => window.__cityfoundry.camera());
const tile = (page, x, y) => page.evaluate(([x, y]) => window.__cityfoundry.sim.getTile(x, y), [x, y]);

async function noHorizontalScroll(page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw).toBeLessThanOrEqual(cw);
}

/** Every visible element in a container sits inside the viewport. */
async function fitsViewport(page, selector) {
  // measure the settled layout, not a sheet mid-way through its entry animation
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));
  const out = await page.evaluate((sel) => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const bad = [];
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) bad.push(`${el.className || el.tagName} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.right)},${Math.round(r.bottom)}`);
    }
    return bad;
  }, selector);
  expect(out, `outside the viewport:\n${out.join('\n')}`).toEqual([]);
}

function collectErrors(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function freshCity(page, name, shotPrefix) {
  await page.goto('/');
  await page.evaluate(
    () =>
      new Promise((r) => {
        const req = indexedDB.deleteDatabase('cityfoundry');
        req.onsuccess = req.onerror = req.onblocked = () => r();
      }),
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'New city' })).toBeVisible();
  await noHorizontalScroll(page);
  if (shotPrefix) await page.screenshot({ path: `test-results/${shotPrefix}-menu.png` });
  await page.getByTestId('city-name').fill(name);
  await page.getByTestId('city-seed').fill(SEED);
  await page.getByTestId('found-city').tap();
  await expect(page.getByTestId('city-title')).toHaveText(name);
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await page.getByTestId('speed-0').tap();
  await noHorizontalScroll(page);
  await fitsViewport(page, '.topbar, .toolbar, .topbar button, .tools');
}

test.describe('phone portrait', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

  test('play a city with touch only', async ({ page }) => {
    const errors = collectErrors(page);
    await freshCity(page, 'Pocketville', 'mobile-portrait');
    const touch = await touchSession(page);
    const canvas = await page.getByTestId('map-canvas').boundingBox();
    const mid = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };

    // Hotkey hints are hidden on touch; every tool button is a ≥44 px target.
    await expect(page.locator('.tool kbd').first()).toBeHidden();
    const sizes = await page.locator('.tool, .speed-btn, .btn-save, .sheet-toggle').evaluateAll((els) =>
      els.map((e) => [e.getBoundingClientRect().width, e.getBoundingClientRect().height]),
    );
    for (const [w, h] of sizes) expect(Math.min(w, h)).toBeGreaterThanOrEqual(40);

    // ---- one-finger drag in Inspect pans
    const c0 = await camera(page);
    await touch.drag(mid, { x: mid.x - 120, y: mid.y - 80 });
    const c1 = await camera(page);
    expect(c1.x).toBeGreaterThan(c0.x + 50);
    expect(c1.y).toBeGreaterThan(c0.y + 30);
    expect(await page.getByTestId('inspect').count()).toBe(0); // a drag is not a tap
    await touch.drag({ x: mid.x - 120, y: mid.y - 80 }, mid); // and back

    // ---- pinch zoom in and out around the midpoint
    const z0 = (await camera(page)).zoom;
    await touch.pinch({ x: mid.x - 40, y: mid.y }, { x: mid.x + 40, y: mid.y }, { x: mid.x - 100, y: mid.y }, { x: mid.x + 100, y: mid.y });
    const z1 = (await camera(page)).zoom;
    expect(z1).toBeGreaterThan(z0 * 1.8);
    await touch.pinch({ x: mid.x - 100, y: mid.y }, { x: mid.x + 100, y: mid.y }, { x: mid.x - 40, y: mid.y }, { x: mid.x + 40, y: mid.y });
    expect((await camera(page)).zoom).toBeCloseTo(z0, 1);

    // ---- a tap in Inspect opens the inspector; its close button closes it
    const world = await page.evaluate(() => window.__cityfoundry.sim.getWorld());
    const oy = world.outsideConnection.y;
    let hx = 0;
    while ((await tile(page, hx + 1, oy)).road?.type === 'highway') hx++;
    await touch.tap(await tileXY(page, hx, oy));
    await expect(page.getByTestId('inspect')).toContainText('Highway');
    await page.getByRole('button', { name: 'Close inspector' }).tap();
    await expect(page.getByTestId('inspect')).toHaveCount(0);

    // ---- centre the work area east of the highway with a one-finger pan
    {
      const p = await tilePos(page, hx + 5, oy);
      await touch.drag(p, { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height * 0.45 });
    }

    // ---- road from the highway by one-finger drag (ghost + Cancel button while dragging)
    await pickTool(page, 'road');
    await expect(page.getByTestId('tool-road')).toHaveAttribute('aria-pressed', 'true');
    const endX = hx + 8;
    await touch.drag(await tileXY(page, hx + 1, oy), await tileXY(page, endX, oy), {
      beforeLift: async () => {
        await expect(page.getByTestId('cursor-hint')).toContainText('$80');
        await expect(page.getByTestId('cancel-drag')).toBeVisible();
        await page.screenshot({ path: 'test-results/mobile-portrait-road-ghost.png' });
      },
    });
    await expect(page.getByTestId('cancel-drag')).toHaveCount(0);
    await expect(page.getByTestId('funds')).toHaveText('$49,920');
    expect((await tile(page, endX, oy)).road?.type).toBe('street');

    // ---- second finger cancels a build drag: nothing built, nothing spent
    await touch.dragThenSecondFinger(await tileXY(page, endX, oy + 1), await tileXY(page, endX, oy + 4), { x: mid.x, y: mid.y - 150 });
    await expect(page.getByTestId('funds')).toHaveText('$49,920');
    expect((await tile(page, endX, oy + 3)).road).toBe(null);

    // ---- sliding onto Cancel and lifting cancels too
    {
      const a = await tileXY(page, endX, oy + 1);
      const b = await tileXY(page, endX, oy + 3);
      let cancelAt = null;
      const cdp = await page.context().newCDPSession(page);
      const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
      await send('touchStart', [{ x: a.x, y: a.y, id: 0 }]);
      for (let i = 1; i <= 6; i++) await send('touchMove', [{ x: a.x + ((b.x - a.x) * i) / 6, y: a.y + ((b.y - a.y) * i) / 6, id: 0 }]);
      await expect(page.getByTestId('cancel-drag')).toBeVisible();
      const cb = await page.getByTestId('cancel-drag').boundingBox();
      cancelAt = { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 };
      await send('touchMove', [{ ...cancelAt, id: 0 }]);
      await send('touchEnd', []);
      await page.waitForTimeout(300);
      await expect(page.getByTestId('funds')).toHaveText('$49,920');
      expect((await tile(page, endX, oy + 2)).road).toBe(null);
    }

    // ---- zone along the road by touch
    const zoneDrag = async (toolId, a, b) => {
      await pickTool(page, toolId);
      await touch.drag(await tileXY(page, a.x, a.y), await tileXY(page, b.x, b.y));
    };
    await zoneDrag('zoneR', { x: hx + 2, y: oy - 1 }, { x: hx + 5, y: oy - 3 });
    await zoneDrag('zoneC', { x: hx + 6, y: oy - 1 }, { x: hx + 8, y: oy - 2 });
    await zoneDrag('zoneI', { x: hx + 2, y: oy + 1 }, { x: hx + 8, y: oy + 3 });
    // and a single tap zones one tile
    await pickTool(page, 'zoneR');
    await touch.tap(await tileXY(page, hx + 2, oy - 4));
    const zones = await page.evaluate(
      ([x0, y]) => {
        const s = window.__cityfoundry.sim;
        return [s.getTile(x0 + 3, y - 2).zone, s.getTile(x0 + 7, y - 1).zone, s.getTile(x0 + 5, y + 2).zone, s.getTile(x0 + 2, y - 4).zone];
      },
      [hx, oy],
    );
    expect(zones).toEqual(['R', 'C', 'I', 'R']);

    // ---- run at speed 3 until people live here
    await pickTool(page, 'inspect');
    await page.getByTestId('speed-3').tap();
    await expect.poll(async () => parseNumber(await page.getByTestId('population').textContent()), { timeout: 60_000 }).toBeGreaterThan(0);
    await page.screenshot({ path: 'test-results/mobile-portrait-game.png' });

    // ---- demand/tax sheet opens over the map and closes again
    await expect(page.getByTestId('demand-panel')).toBeHidden();
    await page.getByTestId('sheet-toggle').tap();
    await expect(page.getByTestId('demand-panel')).toBeVisible();
    await expect(page.getByTestId('demand-R')).toBeVisible();
    await expect(page.getByTestId('tax-R')).toBeVisible();
    await fitsViewport(page, '.demand, .demand *');
    await page.screenshot({ path: 'test-results/mobile-portrait-sheet.png' });
    await page.getByTestId('sheet-close').tap();
    await expect(page.getByTestId('demand-panel')).toBeHidden();

    // ---- bulldoze one road tile with a tap
    await page.getByTestId('speed-0').tap();
    await pickTool(page, 'bulldoze');
    await touch.tap(await tileXY(page, endX, oy));
    await expect.poll(() => tile(page, endX, oy).then((t) => t.road)).toBe(null);

    // ---- save, reload, load: same figures
    await page.getByTestId('save').tap();
    await expect(page.getByTestId('toast')).toContainText('Saved Pocketville');
    const pop = await page.getByTestId('population').textContent();
    const funds = await page.getByTestId('funds').textContent();
    expect(parseNumber(pop)).toBeGreaterThan(0);
    await page.reload();
    await expect(page.getByTestId('save-list')).toBeVisible();
    await page.getByTestId('load-save').filter({ hasText: 'Pocketville' }).first().tap();
    await expect(page.getByTestId('population')).toHaveText(pop);
    await expect(page.getByTestId('funds')).toHaveText(funds);

    await noHorizontalScroll(page);
    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  });
});

test.describe('phone landscape', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

  test('layout fits and touch building works', async ({ page }) => {
    const errors = collectErrors(page);
    await freshCity(page, 'Sideways', 'mobile-landscape');
    const touch = await touchSession(page);

    const world = await page.evaluate(() => window.__cityfoundry.sim.getWorld());
    const oy = world.outsideConnection.y;
    let hx = 0;
    while ((await tile(page, hx + 1, oy)).road?.type === 'highway') hx++;

    // pan so the highway end sits mid-screen: one-finger drag in Inspect
    {
      const canvas = await page.getByTestId('map-canvas').boundingBox();
      const p = await tilePos(page, hx, oy);
      const target = { x: canvas.x + canvas.width * 0.35, y: canvas.y + canvas.height * 0.5 };
      await touch.drag(p, target);
    }

    await pickTool(page, 'road');
    await touch.drag(await tileXY(page, hx + 1, oy), await tileXY(page, hx + 8, oy));
    expect((await tile(page, hx + 8, oy)).road?.type).toBe('street');
    await pickTool(page, 'zoneR');
    await touch.drag(await tileXY(page, hx + 2, oy - 1), await tileXY(page, hx + 7, oy - 2));
    await pickTool(page, 'zoneI');
    await touch.drag(await tileXY(page, hx + 2, oy + 1), await tileXY(page, hx + 7, oy + 2));
    expect((await tile(page, hx + 4, oy - 2)).zone).toBe('R');
    expect((await tile(page, hx + 4, oy + 2)).zone).toBe('I');

    await pickTool(page, 'inspect');
    await page.getByTestId('speed-3').tap();
    await expect.poll(async () => parseNumber(await page.getByTestId('population').textContent()), { timeout: 60_000 }).toBeGreaterThan(0);
    await page.getByTestId('speed-0').tap();
    await page.screenshot({ path: 'test-results/mobile-landscape-game.png' });

    await page.getByTestId('sheet-toggle').tap();
    await expect(page.getByTestId('demand-panel')).toBeVisible();
    await fitsViewport(page, '.demand, .demand *');
    await page.screenshot({ path: 'test-results/mobile-landscape-sheet.png' });
    await page.getByTestId('sheet-toggle').tap();
    await expect(page.getByTestId('demand-panel')).toBeHidden();

    await page.getByTestId('save').tap();
    await expect(page.getByTestId('toast')).toContainText('Saved Sideways');
    await noHorizontalScroll(page);
    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
