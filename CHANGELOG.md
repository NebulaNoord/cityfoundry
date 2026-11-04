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

## Unreleased — Phase 1 Foundation Sprint
- Project scaffold, architecture and API contract (coordinator).
- Simulation core in `src/sim/` (Big Dawg): typed-array world with chunk versions and seeded lakes; protected highway stub; road preview/place/upgrade/bulldoze with incrementally maintained road access and outside connectivity; zoning with the Chebyshev-4 rule; daily demand, land-value-weighted spawning, 3-day construction, move-ins, hiring/layoffs, 5-day abandonment; dirty-region land value; daily taxes and upkeep in exact cents; low-funds/debt/abandonment/no-connection/unemployment notifications; versioned and validated saves with RNG state; IndexedDB save slots (`storage.js`).
- Sim tests: 81 Vitest tests in `tests/sim/` (`npm run test:sim`), including a 1-game-year perf smoke test and storage tests against fake-indexeddb. `npm run test:sim:node` runs the same files under plain Node via `scripts/run-sim-tests.mjs` (no dependencies).
- Internal design notes: `src/sim/README.md`.
