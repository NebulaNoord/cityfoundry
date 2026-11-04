# CityFoundry — Phase 1 Report

Foundation sprint plus visible zoning growth. Built by Big Dawg (simulation) and Picasso (interface), integrated on `main`.

## Milestone checklist
| # | Requirement | Status |
|---|---|---|
| 1 | Application launches | ✅ `npm run dev` / `npm run build` |
| 2 | New city can be created | ✅ Main menu: name + seed |
| 3 | Player can navigate the map | ✅ Pan (drag, WASD/arrows), zoom to cursor |
| 4 | Roads can be placed and removed | ✅ Street/avenue with live cost preview; bulldoze |
| 5 | Zones can be placed | ✅ R/C/I brushes + dezone, road-access rule enforced by the sim |
| 6 | Simulation clock advances | ✅ Pause / 1× / 2× / 3× |
| 7 | Frontend and simulation communicate correctly | ✅ UI only uses the documented API (docs/API.md v0.1.1) |
| 8 | City can be saved and reloaded | ✅ Manual save slots + monthly autosave (IndexedDB) |
| 9 | No major console errors | ✅ E2E asserts zero console errors |
| + | Buildings grow from demand | ✅ Demand, 3-day construction, move-ins, jobs, abandonment |

## Test results (on main)
- Unit: **107 / 107** passing (81 simulation, 26 interface) — `npm test`
- End-to-end: **2 / 2** passing in headless Chrome — `npm run test:e2e`
- Simulation speed: one game year on 128×128 (~1,100 buildings) runs in under 0.2 s.

## Completed features
- Chunked tile world with seeded lakes and a protected highway entrance
- Roads: preview, place, upgrade, bulldoze, costs and daily upkeep; connectivity to the highway
- Zoning with a 4-tile road-access rule
- Growth: R/C/I demand, land-value-weighted spawning, construction, households, employment, abandonment
- Economy: per-zone tax rates (affect demand and income), daily income and expenses, low-funds/debt notices
- Deterministic, versioned saves (identical behaviour after load)
- PixiJS isometric renderer with chunk caching, connected road pieces, procedural buildings, construction/abandoned states
- HUD: date, speed, funds, daily net, population, RCI demand, tax sliders, inspector, notifications

## Outstanding issues and risks
- Job market is city-wide: no commuting, pathfinding or traffic yet.
- Land value only reflects roads, commerce and industry (no services or pollution).
- Abandoned buildings stay until bulldozed.
- Balance numbers are first-pass and need playtesting.
- Desktop only: mouse and keyboard, designed for 1280×720 and up. No touch controls.
- Rendering performance was only measured in a software-GL sandbox; real-GPU numbers still needed.
- Requested API additions: tick on `notification` events, a calendar helper, "abandons in N days" on buildings, `previewZone`/`previewBulldoze`.

## Proposed Phase 2
1. **Traffic (Big Dawg + Picasso):** road graph pathfinding, commute-based job assignment, vehicles and congestion overlay.
2. **Utilities and services:** power, water, sewage, police/fire/health coverage feeding land value.
3. **Building levels 2–5 and multi-tile footprints**, driven by land value.
4. **Overlays and minimap:** land value, connectivity, demand heat, traffic.
5. **Budget panel** with history graphs; auto-demolition of abandoned buildings.
6. **Performance:** move the sim to a Web Worker; batch buildings into a texture atlas.
