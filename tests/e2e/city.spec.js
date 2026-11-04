// End-to-end: found a city, pan/zoom, build a road from the highway, zone
// R/C/I, run at speed 3 until people move in, bulldoze, save, reload, load.
//
// The UI is driven with real mouse/keyboard events. The dev-only
// window.__cityfoundry hook is used only to READ state (tile positions on
// screen, sim tiles) — never to issue commands.
import { test, expect } from '@playwright/test';

const SEED = '4242';

function parseNumber(text) {
  return Number(String(text).replace(/[^0-9.\-−]/g, '').replace('−', '-'));
}

async function tilePos(page, x, y) {
  const p = await page.evaluate(([x, y]) => window.__cityfoundry.tileToScreen(x, y), [x, y]);
  const box = await page.getByTestId('map-canvas').boundingBox();
  return { x: box.x + p.x, y: box.y + p.y };
}

async function tileXY(page, x, y) {
  const q = await tilePos(page, x, y);
  // Make sure a real click there would reach the map, not a HUD panel.
  const onMap = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.dataset?.testid === 'map-canvas', [q.x, q.y]);
  if (!onMap) throw new Error(`tile ${x},${y} is not clickable on the map at ${q.x},${q.y}`);
  return q;
}

async function dragTiles(page, a, b) {
  const p = await tileXY(page, a.x, a.y);
  const q = await tileXY(page, b.x, b.y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 4 });
  await page.mouse.move(q.x, q.y, { steps: 4 });
  await page.mouse.up();
}

test('found, build, grow, bulldoze, save and reload a city', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  // Fresh storage for a deterministic run.
  await page.goto('/');
  await page.evaluate(() => new Promise((r) => {
    const req = indexedDB.deleteDatabase('cityfoundry');
    req.onsuccess = req.onerror = req.onblocked = () => r();
  }));
  await page.reload();

  // ---- main menu → new city
  await expect(page.getByRole('heading', { name: 'New city' })).toBeVisible();
  await page.getByTestId('city-name').fill('Testburg');
  await page.getByTestId('city-seed').fill(SEED);
  await page.getByTestId('found-city').click();
  await expect(page.getByTestId('city-title')).toHaveText('Testburg');
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await expect(page.locator('canvas[data-testid=map-canvas]')).toHaveCount(1);
  await expect(page.getByTestId('funds')).toHaveText('$50,000');

  // Pause so growth doesn't race the setup.
  await page.getByTestId('speed-0').click();

  // ---- pan (right-drag) and zoom (wheel) actually move the camera
  const canvas = page.getByTestId('map-canvas');
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const cam0 = await page.evaluate(() => window.__cityfoundry.camera());
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx - 120, cy - 60, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  const cam1 = await page.evaluate(() => window.__cityfoundry.camera());
  expect(cam1.x).toBeGreaterThan(cam0.x);
  expect(cam1.y).toBeGreaterThan(cam0.y);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(50);
  const cam2 = await page.evaluate(() => window.__cityfoundry.camera());
  expect(cam2.zoom).toBeGreaterThan(cam1.zoom);
  await page.mouse.wheel(0, 300);
  // Keyboard pan
  await page.keyboard.down('d');
  await page.waitForTimeout(150);
  await page.keyboard.up('d');
  const cam3 = await page.evaluate(() => window.__cityfoundry.camera());
  expect(cam3.x).toBeGreaterThan(cam2.x - 1);

  // Bring the highway end into view by right-dragging back to where we started.
  await page.mouse.move(cx - 120, cy - 60);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx, cy, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await page.keyboard.down('a');
  await page.waitForTimeout(150);
  await page.keyboard.up('a');

  const world = await page.evaluate(() => window.__cityfoundry.sim.getWorld());
  const oy = world.outsideConnection.y;
  // Highway occupies x = 0..5 on row oy; start the street on its last tile.
  let hx = 0;
  while (await page.evaluate(([x, y]) => window.__cityfoundry.sim.getTile(x, y).road?.type === 'highway', [hx + 1, oy])) hx++;

  // ---- road tool with ghost preview, then build by drag
  await page.keyboard.press('r');
  await expect(page.getByTestId('tool-road')).toHaveAttribute('aria-pressed', 'true');
  // pressing R again toggles street ↔ avenue
  await page.keyboard.press('r');
  await expect(page.getByTestId('road-avenue')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('road-street').click();
  await expect(page.getByTestId('road-street')).toHaveAttribute('aria-checked', 'true');
  const endX = hx + 18;
  {
    const p = await tileXY(page, hx + 1, oy);
    const q = await tileXY(page, endX, oy);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(q.x, q.y, { steps: 6 });
    // live preview: cost shown in the cursor hint
    await expect(page.getByTestId('cursor-hint')).toContainText('$180');
    await page.screenshot({ path: 'test-results/e2e-road-ghost.png' });
    await page.mouse.up();
  }
  await expect(page.getByTestId('funds')).toHaveText('$49,820');
  const roadTile = await page.evaluate(([x, y]) => window.__cityfoundry.sim.getTile(x, y), [endX, oy]);
  expect(roadTile.road?.type).toBe('street');

  // ---- zones along the road (real drags with hotkeys)
  await page.keyboard.press('z');
  await dragTiles(page, { x: hx + 2, y: oy - 1 }, { x: hx + 7, y: oy - 3 });
  await dragTiles(page, { x: hx + 2, y: oy + 1 }, { x: hx + 7, y: oy + 3 });
  await page.keyboard.press('x');
  await dragTiles(page, { x: hx + 8, y: oy - 1 }, { x: hx + 12, y: oy - 2 });
  await page.keyboard.press('c');
  await dragTiles(page, { x: hx + 8, y: oy + 1 }, { x: hx + 16, y: oy + 3 });
  const zones = await page.evaluate(([x0, y]) => {
    const s = window.__cityfoundry.sim;
    return [s.getTile(x0 + 3, y - 2).zone, s.getTile(x0 + 10, y - 1).zone, s.getTile(x0 + 12, y + 2).zone];
  }, [hx, oy]);
  expect(zones).toEqual(['R', 'C', 'I']);

  // Zone brush beyond road access is flagged as invalid in the hint.
  await page.keyboard.press('z');
  {
    const p = await tileXY(page, hx + 4, oy - 9);
    await page.mouse.move(p.x, p.y);
    await expect(page.getByTestId('cursor-hint')).toContainText('No road within 4 tiles');
  }
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tool-inspect')).toHaveAttribute('aria-pressed', 'true');

  // ---- run at speed 3 until people live here
  await page.getByTestId('speed-3').click();
  await expect
    .poll(async () => parseNumber(await page.getByTestId('population').textContent()), { timeout: 60_000 })
    .toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/e2e-grown.png' });

  // ---- inspect a building
  const bld = await page.evaluate(() => window.__cityfoundry.sim.getBuildings()[0]);
  {
    const p = await tileXY(page, bld.x, bld.y);
    await page.mouse.click(p.x, p.y);
    await expect(page.getByTestId('inspect')).toContainText('building');
    await expect(page.getByTestId('inspect')).toContainText(`Tile ${bld.x}, ${bld.y}`);
  }

  // ---- bulldoze a road tile (end of the street); Esc closes the inspector first
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('inspect')).toHaveCount(0);
  await page.keyboard.press('b');
  {
    const p = await tileXY(page, endX, oy);
    await page.mouse.click(p.x, p.y);
  }
  await expect
    .poll(() => page.evaluate(([x, y]) => window.__cityfoundry.sim.getTile(x, y).road, [endX, oy]))
    .toBe(null);

  // ---- Space toggles pause (after clicking a HUD button, focus returns to the map)
  await page.keyboard.press('Space');
  await expect(page.getByTestId('speed-0')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('speed-3')).toHaveAttribute('aria-checked', 'true');

  // ---- pause, save, remember HUD figures
  await page.keyboard.press('0');
  await expect(page.getByTestId('speed-0')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('toast')).toContainText('Saved Testburg');
  const pop = await page.getByTestId('population').textContent();
  const funds = await page.getByTestId('funds').textContent();
  const date = await page.getByTestId('date').textContent();
  expect(parseNumber(pop)).toBeGreaterThan(0);

  // ---- reload, load the save, same figures
  await page.reload();
  await expect(page.getByTestId('save-list')).toBeVisible();
  await page.getByTestId('load-save').filter({ hasText: 'Testburg' }).first().click();
  await expect(page.getByTestId('city-title')).toHaveText('Testburg');
  await expect(page.getByTestId('population')).toHaveText(pop);
  await expect(page.getByTestId('funds')).toHaveText(funds);
  await expect(page.getByTestId('date')).toHaveText(date);
  // bulldozed tile is still gone after the round trip
  expect(await page.evaluate(([x, y]) => window.__cityfoundry.sim.getTile(x, y).road, [endX, oy])).toBe(null);

  // ---- Main menu button autosaves; Continue brings the city back
  await page.getByRole('button', { name: 'Main menu' }).click();
  await expect(page.getByTestId('continue')).toContainText('Testburg');
  await page.getByTestId('continue').click();
  await expect(page.getByTestId('population')).toHaveText(pop);
  await expect(page.getByTestId('funds')).toHaveText(funds);

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
});

test('road preview shows the reason when placement is invalid', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByTestId('city-seed').fill(SEED);
  await page.getByTestId('found-city').click();
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await page.getByTestId('speed-0').click();

  // Find a water tile near the start view to aim a road through.
  const target = await page.evaluate(() => {
    const s = window.__cityfoundry.sim;
    const w = s.getWorld();
    for (const t of s.getTilesInRect(0, 0, w.width - 1, w.height - 1)) if (t.terrain === 'water') return t;
    return null;
  });
  test.skip(!target, 'no water on this seed');
  // Centre the view on the lake with the keyboard-free route: drag the map.
  await page.keyboard.press('r');
  const view = await page.getByTestId('map-canvas').boundingBox();
  for (let i = 0; i < 40; i++) {
    const p = await tilePos(page, target.x, target.y);
    const dx = view.x + view.width / 2 - p.x, dy = view.y + view.height / 2 - p.y;
    if (Math.abs(dx) < 200 && Math.abs(dy) < 150) break;
    const sx = view.x + view.width / 2, sy = view.y + view.height / 2;
    const stepX = Math.max(-400, Math.min(400, dx)), stepY = Math.max(-250, Math.min(250, dy));
    await page.mouse.move(sx, sy);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(sx + stepX, sy + stepY, { steps: 3 });
    await page.mouse.up({ button: 'middle' });
  }
  const a = await tileXY(page, target.x - 3, target.y);
  const b = await tileXY(page, target.x + 3, target.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await expect(page.getByTestId('cursor-hint')).toHaveClass(/bad/);
  await page.screenshot({ path: 'test-results/e2e-road-invalid.png' });
  await page.keyboard.press('Escape'); // cancel the drag: nothing is built
  await page.mouse.up();
  await expect(page.getByTestId('funds')).toHaveText('$50,000');
  expect(errors).toEqual([]);
});
