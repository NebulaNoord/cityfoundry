# CityFoundry Architecture — Phase 1

## Layers

```
┌───────────────────────────── Browser ─────────────────────────────┐
│  src/ui/  (Picasso)                                                │
│   React app shell ── menus, toolbar, panels, stats                 │
│   Zustand store   ── UI-only state: tool, camera, selection, hover │
│   PixiJS renderer ── isometric world, chunk-cached tile layers     │
│        │  reads via queries + events, writes only via commands     │
│        ▼                                                           │
│  src/sim/ (Big Dawg)  — pure JS, no DOM                            │
│   index.js      createSimulation / loadSimulation (public API)     │
│   world.js      chunked tile grid, terrain generation              │
│   roads.js      road placement, network components, connectivity   │
│   zoning.js     zone painting, road-access rules                   │
│   growth.js     demand, spawning, construction, occupancy          │
│   economy.js    taxes, upkeep, funds                               │
│   landvalue.js  land value field                                   │
│   clock.js      ticks, calendar, speed, real-time driver           │
│   events.js     tiny event emitter                                 │
│   rng.js        seeded deterministic RNG                           │
│   serialize.js  save format + validation                           │
│   storage.js    IndexedDB wrapper (browser only, not used by core) │
└────────────────────────────────────────────────────────────────────┘
```

## Rules

1. `src/sim/**` never imports from `src/ui/**`, React, PixiJS or DOM APIs (except `storage.js`).
2. `src/ui/**` never mutates sim state directly and never re-implements sim rules. It calls commands and renders query results. Previews (road ghost, zone brush validity) come from sim functions (`previewRoad`, `getTile().roadAccess`).
3. The contract is `docs/API.md`. Changes go in `CHANGELOG.md` under "Interface changes" first.
4. One game loop: the UI's `requestAnimationFrame` calls `sim.update(dt)`, then renders. Phase 1 keeps the sim on the main thread; a Web Worker split is a Phase 2 option (the API is already message-friendly: plain data in, plain data out).
5. Determinism: all randomness goes through `rng.js` with a saved state. Same seed + same commands → same city.
6. Rendering is chunk-cached: the renderer rebuilds a chunk's graphics only when `getChunkVersion` changes.

## Stack
Vite · JavaScript (ES modules) · React 18 · PixiJS 8 · Zustand · IndexedDB · Vitest (sim + UI unit tests) · Playwright (end-to-end, Chrome at `/usr/bin/google-chrome`).

## Ownership
| Path | Owner |
|---|---|
| `src/sim/**`, `tests/sim/**`, `docs/API.md` | Big Dawg |
| `src/ui/**`, `src/main.jsx`, `index.html`, `tests/e2e/**`, `tests/ui/**` | Picasso |
| `package.json`, `vite.config.js`, `CHANGELOG.md`, `README.md` | shared — coordinate |
