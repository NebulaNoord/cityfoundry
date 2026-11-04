# src/ui: CityFoundry frontend

Owner: Picasso. Consumes the simulation through `src/sim/index.js` and
`src/sim/storage.js` only, following `docs/API.md`. The UI never mutates sim
state and never computes sim figures. Every number on screen comes from
`getStats()`, `getTime()`, `getTile()`, `getBuilding()` or `previewRoad()`.

## Structure

```
src/main.jsx                 React root, fonts, global CSS
src/ui/App.jsx               menu ↔ game switch (one sim instance at a time)
src/ui/store.js              Zustand store: UI state + throttled sim snapshots
src/ui/tools.js              tool table, hotkeys, rect helpers, zone-brush validity, error text
src/ui/format.js             display formatting only (money, dates)
src/ui/slots.js              save-slot naming (one slot per city name + seed)
src/ui/game/GameController.js  owns sim + renderer + camera + input + the rAF loop
src/ui/render/
  iso.js                     projection, inverse, picking, visible tile range (pure)
  camera.js                  pan/zoom/clamp math, zoom-to-cursor (pure)
  roadPieces.js              neighbour mask → straight/corner/tee/cross/dead-end (pure)
  draw.js                    projected drawing primitives: boxes, gable roofs, shadows
  palette.js                 world colours (zone hues mirror tokens.css)
  chunkArt.js                terrain, water banks, roads + markings, zone tint, lots
  buildings.js               procedural R houses, C shops, I factories, construction, abandoned
  WorldRenderer.js           PixiJS app, layers, chunk cache, culling, overlay
src/ui/components/           MainMenu, SitePlan, GameScreen, TopBar, Toolbar,
                             DemandPanel (RCI + taxes), InspectPanel, Notifications,
                             CursorHint, Toast, icons
src/ui/styles/               tokens.css (design tokens), app.css
```

## Frame loop

One `requestAnimationFrame` loop in `GameController.frame`:

1. `sim.update(dt)` (the sim decides how many ticks to run)
2. keyboard panning
3. `renderer.render(camera)`

React never re-renders per frame. The controller pushes snapshots into the
store on sim events: `statsChanged` → stats, `day` → time, autosave and
inspector refresh, `notification` → feed, `tilesChanged` → inspector and drag
preview refresh. Pointer hover changes the store only when the hovered *tile*
changes.

## Render pipeline

Layers inside one `world` container that carries the camera transform:

| Layer | Content | Built |
|---|---|---|
| edge | concrete slab sides of the map | once |
| ground | terrain, water + banks, zone tint, roads + markings, building lots | per chunk |
| access | darkening of tiles without `roadAccess` (zone tools only) | per chunk |
| shadows | building ground shadows | per chunk |
| objects | buildings, sorted by `x+y` inside the chunk | per chunk |
| overlay | hover, selection, road ghost, zone/bulldoze rectangles | on change |

- **Chunk cache.** Each 16×16 chunk owns four `Graphics`. A chunk is rebuilt
  only when `sim.getChunkVersion(cx, cy)` differs from the version it was
  built at. A rebuild reads `getTilesInRect` with a 1-tile border, so road
  pieces and water banks connect across chunk edges. Building state changes
  (construction progress, abandonment) bump the chunk version in the sim, so
  no separate building cache is needed.
- **Culling.** Chunks outside the view (plus a margin for tall buildings) are
  hidden and not rebuilt until they come into view.
- **Budget.** Stale chunks are rebuilt nearest-to-centre first, at most about
  8 ms per frame and at least one per frame.
- **Depth.** Chunk containers are ordered by `(cx+cy, cx)`, and buildings
  within a chunk by `(x+y, x)`. All Phase 1 buildings are 1×1, so this is
  exact.
- **Render on demand.** `render()` skips `app.render()` when the camera, chunk
  versions, visibility and overlay are all unchanged. On software WebGL
  (SwiftShader, llvmpipe) a full-screen redraw costs about 100 ms, so an idle
  map would otherwise run at about 8 fps.
- **Software GL.** MSAA is off and the resolution is 1× when the WebGL
  renderer string looks like a CPU rasteriser.
- **Context loss.** On `webglcontextlost` the loop stops drawing and a
  status banner shows. On restore every chunk is invalidated and rebuilt.

Projection: tile `(x, y)` has its top vertex at `sx = (x−y)·32`, `sy = (x+y)·16`
(TW 64, TH 32). Picking is the exact inverse, followed by `floor`.

## Controls

| Action | Input |
|---|---|
| Pan | Right or middle mouse drag, Space + left drag, WASD or arrow keys |
| Zoom (to cursor) | Mouse wheel; `+` / `−` zoom at the screen centre |
| Inspect | `Q`, then click a tile |
| Road | `R` (press again to switch street ↔ avenue), then drag |
| Zone residential / commercial / industrial | `Z` / `X` / `C`, then drag a rectangle |
| Dezone | `V`, then drag a rectangle |
| Bulldoze | `B`, then click or drag a rectangle |
| Cancel drag, then clear selection, then back to Inspect | `Esc` |
| Pause toggle | Space (tap) |
| Speed | `0` or `P` pause, `1`, `2`, `3` |
| Save | Save button (top right) |

Tool previews:

- **Road.** The ghost path, cost and validity come from `sim.previewRoad`.
  An invalid path is drawn red, and the hint shows the sim's `message` (or a
  description of the error code).
- **Zone.** Tiles that are water, road, or lack `roadAccess` (read from the
  sim) are drawn with a red cross. The whole map darkens wherever there is no
  road access.
- **Bulldoze.** The rectangle highlights the tiles that hold something.

## Saving

- The Save button writes slot `city-<name>-<seed>`.
- The autosave slot is written on the 1st of every in-game month, when the
  tab is hidden, and when you return to the menu.
- The menu lists saves newest first via `listSaves()`, and offers Continue
  when an autosave exists.

## Debug hook

In dev builds, or with `?debug` in the URL, `window.__cityfoundry` exposes
`{ sim, camera(), renderStats(), tileToScreen(x, y) }`. The e2e tests use it
only to read state and to find where a tile is on screen. All interaction in
the tests goes through real mouse and keyboard events.

## Tests

- `npm test` runs the Vitest suite, sim and UI. The UI unit tests are in
  `tests/ui/`: projection and picking, road pieces, camera math, tools,
  store, formatting, slots.
- `npm run test:e2e` runs Playwright against the Vite dev server on port
  4321, in headless system Chrome with SwiftShader. Screenshots go to
  `test-results/`.
