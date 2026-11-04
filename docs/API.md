# CityFoundry Simulation API — v0.1.1 (Phase 1 contract)

Owner: **Big Dawg** (simulation). Consumer: **Picasso** (frontend).
This file is the contract. Neither side changes a signature, event name or
data shape here without writing the change in `CHANGELOG.md` under
"Interface changes" first and telling the coordinator.

The simulation lives in `src/sim/` and is **pure JavaScript with no DOM,
React, PixiJS or browser globals** (the one exception is `src/sim/storage.js`,
which wraps IndexedDB and is never imported by the core). It must run under
Node for tests and headless runs.

Entry point: `import { createSimulation, loadSimulation, SAVE_VERSION, SaveError, CHUNK_SIZE } from './sim/index.js'`

---

## 1. World and coordinates

- Map is a grid of square tiles, `width × height` (default **128 × 128**).
- Tile coordinates are integers: `x` grows east, `y` grows south. `(0,0)` is the north-west corner.
- Storage is chunked: `CHUNK_SIZE = 16`. Chunk `(cx, cy)` covers tiles `cx*16 … cx*16+15`.
- Isometric projection is **the frontend's job only**. The sim never knows about pixels.
- Neighbours are 4-way (N, E, S, W). Roads connect only orthogonally; an intersection is any road tile with 3–4 road neighbours.

### Tile shape (returned by `getTile`, read-only snapshot)
```js
{
  x, y,
  terrain: 'grass' | 'water',        // water is unbuildable
  road: null | { type: 'street' | 'avenue' | 'highway' },
  zone: null | 'R' | 'C' | 'I',      // zoning paint, independent of building
  buildingId: null | number,
  landValue: number,                 // 0..100
  roadAccess: boolean,               // some road tile is within ZONE_DEPTH = 4 tiles (Chebyshev distance)
  connected: boolean                 // at least one such road belongs to a network that reaches the outside connection
}
```

## 2. Creating and loading

```js
const sim = createSimulation({ width = 128, height = 128, seed = Date.now(), name = 'New City' })
const sim2 = loadSimulation(saveData)   // saveData from sim.serialize() (object or its JSON string); throws SaveError on bad/foreign data
```
A new world is generated from `seed` (deterministic): grass with a few lakes,
and an **outside connection** — a short `highway` stub entering from the
middle of the west edge. Growth only happens on tiles whose road network
reaches the outside connection. The highway stub cannot be bulldozed.

## 3. Commands

Every command returns a **Result**:
```js
{ ok: true,  cost: number, changed: [{x,y}, ...] }
{ ok: false, error: 'INSUFFICIENT_FUNDS' | 'BLOCKED' | 'OUT_OF_BOUNDS' | 'WATER' | 'NO_ROAD_ACCESS' | 'PROTECTED' | 'INVALID', message: string }
```
Commands are atomic: on `ok:false` nothing changed and no money was spent.

| Command | Behaviour |
|---|---|
| `previewRoad(from, to, type='street')` | Returns `{ path:[{x,y}], cost, valid, error?, message? }` — does **not** mutate. `error`/`message` use the same codes as `placeRoad`. Path is a straight line if `from`/`to` share a row/column, otherwise an L (horizontal first). Tiles that already have the same road are free. |
| `placeRoad(from, to, type='street')` | Builds the preview path. Road on a zoned tile clears the zone; road on a building tile is `BLOCKED`. |
| `bulldoze(cells)` | `cells: [{x,y}]`. Removes building, else road, else zone, per tile. Refunds nothing. Highway stub is `PROTECTED` (skipped, not an error, if mixed with other cells). |
| `paintZone(cells, zone)` | `zone: 'R'|'C'|'I'|null` (`null` = dezone). Skips water/road tiles and tiles without `roadAccess`; returns `changed` with only the tiles that actually changed. If nothing could be zoned and at least one cell was skipped for lack of road access, returns `NO_ROAD_ACCESS` instead. Dezoning ignores road access. Zoning is free. Dezoning a tile with a building marks the building for abandonment. |
| `setSpeed(n)` | `0` pause, `1`, `2`, `3`. Anything else → `INVALID`. |
| `setTaxRate(zone, pct)` | `zone: 'R'|'C'|'I'`, `pct` integer 0–29. Default 9. Affects demand (immediately) and income (from the next day). Emits `statsChanged` when the rate changes. Invalid input → `INVALID`. |

Costs (Phase 1): street **$10/tile**, avenue **$25/tile**. Upkeep street $0.5/tile/day, avenue $1.2/tile/day. Starting funds **$50,000**.

## 4. Time

- 1 tick = 1 in-game hour. 24 ticks = 1 day, 30 days = 1 month, 12 months = 1 year. Start: Year 1, Month 1, Day 1.
- `sim.update(dtMs)` — real-time driver called by the frontend every frame; returns the number of ticks it ran. Ticks per real second: speed 1 → 12, speed 2 → 24, speed 3 → 48. Backlog is capped at one real second of ticks; anything beyond that is dropped (no spiral of death after a tab sleeps).
- `sim.step(n = 1)` — advance exactly `n` ticks regardless of speed/pause (tests, debugging).
- Daily systems (demand, growth, move-ins, finances) run on the tick where `hour === 0`.

`sim.getTime()` → `{ tick, hour, day, month, year, speed }`

## 5. Queries (all return fresh plain objects/arrays; mutating them does nothing)

| Query | Returns |
|---|---|
| `getWorld()` | `{ width, height, chunkSize, name, seed, outsideConnection: {x,y} }` |
| `getTile(x, y)` | Tile shape above, or `null` out of bounds |
| `getTilesInRect(x0, y0, x1, y1)` | Array of tiles, inclusive, clamped to the map (for rendering the visible area) |
| `getChunkVersion(cx, cy)` | Integer that increases whenever anything in that chunk changes (render caching); `null` for a chunk outside the map |
| `getBuilding(id)` | Building shape below, or `null` |
| `getBuildings()` | Array of all buildings |
| `getStats()` | Stats shape below |
| `getRoadNetwork()` | `{ tiles: number, components: number, connectedTiles: number }` |
| `getNotifications(limit=20)` | Newest first: `{ id, tick, level: 'info'|'warn'|'alert', message }` |

### Building shape
```js
{
  id, zone: 'R'|'C'|'I', level: 1,         // levels 2–5 reserved for Phase 2
  x, y, w: 1, h: 1,                         // footprint; Phase 1 only grows 1×1, data model supports more
  state: 'constructing' | 'active' | 'abandoned',
  constructionProgress: 0..1,
  capacity: number,                          // households (R) or jobs (C/I)
  occupants: number,                         // households living / workers employed
  builtTick: number
}
```

### Stats shape
```js
{
  population: number,            // residents (households × avg household size, an integer the sim owns)
  households: number,
  jobs: { C: number, I: number, total: number },    // filled jobs
  jobCapacity: { C, I, total },
  workers: number,               // employed residents
  unemployed: number,
  funds: number,
  daily: { income: number, expenses: number, net: number },   // last completed day
  taxRates: { R, C, I },
  demand: { R: -100..100, C: -100..100, I: -100..100 },
  buildings: { R: number, C: number, I: number, total: number }
}
```
Every number shown in the UI must come from here. The frontend never
computes simulation figures itself.

## 6. Events

```js
const off = sim.on(eventName, handler)   // returns unsubscribe
```
| Event | Payload | When |
|---|---|---|
| `tick` | `{ tick }` | every tick |
| `day` | `{ day, month, year }` | after daily systems run |
| `tilesChanged` | `{ cells: [{x,y}], chunks: [{cx,cy}] }` | any tile change (commands or growth) |
| `buildingAdded` / `buildingChanged` / `buildingRemoved` | `{ building }` | building lifecycle |
| `statsChanged` | `{ stats }` | after each day and after any command that costs money |
| `notification` | `{ id, level, message }` | e.g. funds low, no outside connection, high unemployment |

Handlers run synchronously; a throwing handler is caught and logged and does not break the sim.

## 7. Persistence

- `sim.serialize()` → JSON-safe object `{ version: SAVE_VERSION, ... }`. Round trip `loadSimulation(sim.serialize())` must reproduce identical `getStats()`, tiles and buildings, and identical future behaviour (RNG state is saved).
- `src/sim/storage.js` (browser only): `saveCity(slot, sim)`, `loadCity(slot) → sim`, `listSaves() → [{ slot, name, savedAt, population, funds }]`, `deleteSave(slot)`. All return Promises. Slot `'autosave'` is reserved (exported as `AUTOSAVE_SLOT`). `listSaves` is newest first; `loadCity` rejects with `SaveError` for a missing or corrupt slot. Each function takes an optional last argument `{ factory }` (an `IDBFactory`, for tests).

## 8. Growth model (Phase 1 + zoning growth)

Runs daily. Must be real mechanics, not decoration:
- **Demand**: R rises when jobs exceed workers and falls with high R tax; C rises with population per commercial job; I has a base demand plus a share of population; all fall with tax above 9%.
- **Spawning**: up to N new buildings per day (scaled by demand) on zoned, empty, `connected` tiles, preferring higher land value. Seeded RNG.
- **Construction**: a new building is `constructing` for 3 days, then `active`.
- **Occupancy**: households move into R buildings with free capacity while R demand > 0; residents take jobs at C/I with free capacity; C/I buildings only fill with available workers.
- **Abandonment**: a building loses its road connection or zoning → `abandoned` after 5 days; abandoned buildings empty out.
- **Land value**: base 30, + near roads, + near commercial, − near industrial (within 4 tiles). Recomputed for dirty areas.
- **Finances (daily)**: income = Σ R households × R tax factor + Σ C/I filled jobs × tax factor; expenses = road upkeep. Funds may go negative; a warning notification fires below $5,000.

## 9. Phase 1 behaviour notes (clarifications, no shape changes)

- **Error order** for roads: `INVALID` (bad cells/type; `highway` is not buildable) → `OUT_OF_BOUNDS` → `WATER` → `BLOCKED` → `INSUFFICIENT_FUNDS`. Placing a different road type over an existing road replaces it at the new type's full price.
- **bulldoze** returns `OUT_OF_BOUNDS` only if every cell is outside the map, `PROTECTED` only if every in-map cell with something on it is highway; otherwise `ok:true` with the tiles that changed. It emits `statsChanged` when a road or building was removed.
- **Stats**: `population = households × 3`. Labour force = `floor(households × 1.5)`; `workers` = filled jobs; `unemployed = max(0, labourForce − workers)`. `jobs`/`jobCapacity` count active buildings only. `buildings` counts every structure, including constructing and abandoned ones. `daily` is all zeros until the first day completes.
- **Abandoned buildings** stay (empty) until bulldozed and block new growth on their tiles; reconnecting or rezoning does not revive them. A building recovers if its problem is fixed before the 5th day.
- **Money** is exact to the cent: `funds`, `daily.*` are dollars with at most 2 decimals.
- **Notifications** in Phase 1: low funds (`warn`, on crossing below $5,000), debt (`alert`, on crossing below $0), buildings abandoned (`warn`), zoned land with no connection (`warn`, at most monthly), high unemployment (`warn`, more than 25% of a labour force of 30 or more, at most monthly). The sim keeps the newest 200.
- **Event order within a tick**: `tick`, then `tilesChanged`, `buildingAdded`, `buildingChanged`, `buildingRemoved`, `notification` for everything that tick changed, then (on day ticks) `day` and `statsChanged`. Command events are emitted before the command returns.
