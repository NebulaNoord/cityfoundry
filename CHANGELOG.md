# CityFoundry Changelog

## Interface changes
### v0.1.1 (Big Dawg, branch big-dawg/sim). Additive only; nothing renamed or reshaped
- `index.js` also exports `SaveError` and `CHUNK_SIZE`.
- `loadSimulation` also accepts the JSON string of a save.
- `previewRoad` result gains an optional `message` next to `error`.
- `sim.update(dtMs)` returns the number of ticks it ran.
- `getChunkVersion` returns `null` for chunks outside the map.
- `paintZone` returns `NO_ROAD_ACCESS` when nothing could be zoned and at least one cell lacked road access. A mixed brush still succeeds and skips those cells.
- `setTaxRate` emits `statsChanged` when the rate changes; `bulldoze` emits it when a road or building was removed.
- `storage.js`: functions return Promises, take an optional `{ factory }` last argument, and the module exports `AUTOSAVE_SLOT`. `loadCity` rejects with `SaveError` for a missing slot.
- New `docs/API.md` §9 documents error order, stat definitions, abandoned-building lifetime, notification rules and in-tick event order.

### Requested interface changes (Picasso)
Nothing below blocks Phase 1; the UI works around each gap in UI code only.
- `notification` event payload: please add `tick`, the way `getNotifications()` already does. The UI currently stamps each notification with `getTime()` when it arrives, and notifications restored from a save show no date.
- A sim-owned calendar helper (e.g. `sim.calendarOf(tick) → { day, month, year }`), so the UI can date a restored notification without re-implementing the calendar.
- Building shape: an optional `troubleDays` / `abandonInDays`, so the inspector can warn "abandons in N days" before it happens. Today the UI can only show it after the fact.
- Optional `previewZone(cells, zone)` / `previewBulldoze(cells)` mirroring `previewRoad`. Today the zone brush judges validity from `getTile()` fields (terrain, road, roadAccess) as ARCHITECTURE.md allows. The bulldoze highlight marks tiles that hold a building, road (not highway) or zone, without a sim check.

## Unreleased — Phase 1 Foundation Sprint
- Project scaffold, architecture and API contract (coordinator).
- Simulation core in `src/sim/` (Big Dawg): typed-array world with chunk versions and seeded lakes; protected highway stub; road preview/place/upgrade/bulldoze with incrementally maintained road access and outside connectivity; zoning with the Chebyshev-4 rule; daily demand, land-value-weighted spawning, 3-day construction, move-ins, hiring/layoffs, 5-day abandonment; dirty-region land value; daily taxes and upkeep in exact cents; low-funds/debt/abandonment/no-connection/unemployment notifications; versioned and validated saves with RNG state; IndexedDB save slots (`storage.js`).
- Sim tests: 81 Vitest tests in `tests/sim/` (`npm run test:sim`), including a 1-game-year perf smoke test and storage tests against fake-indexeddb. `npm run test:sim:node` runs the same files under plain Node via `scripts/run-sim-tests.mjs` (no dependencies).
- Internal design notes: `src/sim/README.md`.
- Frontend in `src/ui/` (Picasso): main menu (new city with name + seed and a live site survey of the seed's terrain, saved-city list, Continue from autosave); PixiJS 8 isometric renderer with 16×16 chunk caching keyed on `getChunkVersion`, view culling, a per-frame rebuild budget and render-on-demand; connected road pieces (straight/corner/tee/cross/dead-end) for street, avenue and highway with markings and crosswalks; water banks; zone tint (hatched when not connected); procedural R houses, C shops and I factories with shadows, scaffolded construction and decayed abandoned states; camera with drag/keyboard pan and zoom-to-cursor clamped to the map; tools (inspect, road with `previewRoad` ghost/cost/error, R/C/I zone and dezone rectangles with road-access validity, bulldoze click/rectangle, Esc cancel); HUD (city, date, speed, funds, daily net, population, jobs), RCI demand gauges, tax sliders, tile/building inspector, notices feed, cursor hints, toasts; save button, monthly/tab-hide/quit autosave; WebGL context-loss banner and rebuild on restore. Design tokens in `src/ui/styles/tokens.css`; notes in `src/ui/README.md`.
- UI tests: Vitest unit tests in `tests/ui/` (projection and picking inverse, road pieces, camera clamp and zoom-to-cursor, tools, store reducers, formatting, slots); Playwright e2e in `tests/e2e/` (found city, pan/zoom, road from highway, zone R/C/I, grow at speed 3, inspect, bulldoze, save, reload, load, Continue, zero console errors; invalid road preview over water).
- Dependencies: `@fontsource/barlow`, `@fontsource/barlow-condensed` (self-hosted OFL fonts, no network font loading).
