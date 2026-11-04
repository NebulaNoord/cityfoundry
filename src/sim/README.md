# src/sim — internals

Pure ES modules, zero runtime dependencies, no DOM. Public surface is `index.js`
(contract: `docs/API.md`). `storage.js` is browser-only and imported by the UI
directly, never by the core.

## Data layout (`world.js`)

One state object `s` per simulation. Per-tile data is **flat typed arrays over
the whole map**, index `i = y * width + x`:

| Array | Type | Meaning | Saved? |
|---|---|---|---|
| `terrain` | Uint8 | 0 grass, 1 water | yes (RLE) |
| `road` | Uint8 | 0 none, 1 street, 2 avenue, 3 highway | yes (RLE) |
| `zone` | Uint8 | 0 none, 1 R, 2 C, 3 I | yes (RLE) |
| `landValue` | Uint8 | 0..100 | yes (RLE) |
| `buildingAt` | Int32 | building id or 0 | derived |
| `ciAt` | Uint8 | zone of a live C/I building on the tile (land value input) | derived |
| `accessCount` | Uint16 | road tiles within Chebyshev 4 → `roadAccess = > 0` | derived |
| `connCount` | Uint16 | *connected* road tiles within Chebyshev 4 → `connected = > 0` | derived |
| `roadConnected` | Uint8 | road tile is in the outside-connected network | derived |
| `chunkVersion` | Uint32 per 16×16 chunk | bumped on any tile change in the chunk | yes |

Chunks are a *versioning* concept only (render caching); storage is flat
because every system needs neighbourhood windows that cross chunk borders.
At 256×256 the arrays total ~1 MB.

Other state: `buildings: Map<id, building>` (insertion = id order),
`roadTiles: Set<idx>`, `emptyZoned[zone]: Set<idx>` (zoned tiles with no
building — the spawn candidates), a dirty list for land value, the clock,
the `Rng` (sfc32, 4×uint32 state), funds **in integer cents**, tax rates,
demand, last day's income/expenses, notifications, and alert latches.

Money is integer cents internally so totals are exact and identical after a
save/load; the API exposes dollars (`cents / 100`).

## Transactions and events (`events.js`, `index.js`)

Every command and every tick is a transaction: modules record touched tiles,
added/changed/removed buildings and notifications in a `ChangeTracker`.
`#commit()` then flushes dirty land value, converts touched tiles into one
`tilesChanged` payload (bumping each affected chunk's version once), and emits
building events (sorted by id) and notifications. Handlers therefore only ever
see consistent state. A handler that throws is caught and logged
(`console.error`), and other handlers still run.

Per tick: advance clock → (if `hour === 0`) daily systems → `tick` →
committed change events → (daily) `day` → `statsChanged`.

## Roads (`roads.js`)

- `planRoad` is the single validation path used by both `previewRoad` and
  `placeRoad`, so the preview can never disagree with the build. Checks run in a
  fixed order: bounds → water → building (`BLOCKED`) → funds. Existing tiles of
  the same type and highway tiles are free and left alone; a different type is
  an upgrade/downgrade charged at the new type's price.
- Adding/removing a road tile adds ±1 to `accessCount` over its 9×9 window.
- After any road change, `recomputeNetwork` BFSes from the outside connection
  (O(road tiles)), flips `roadConnected` where it changed (±1 to `connCount`
  over that tile's window) and counts components with further BFSes.
  At Phase 1 sizes this is far below 1 ms; see Phase 2 notes for incremental
  union-find if road counts get large.

## Zoning (`zoning.js`)

`planZone` validates and filters (water, road, no road access, unchanged) and
`applyZone` writes, maintaining `emptyZoned`. If nothing in the brush could be
zoned because of missing road access, the command fails with
`NO_ROAD_ACCESS`; mixed brushes succeed and return only changed tiles.
Dezoning (`null`) is allowed without road access.

## Daily systems (`growth.js`, `economy.js`), in order

1. **Buildings** (`dailyBuildings`): a building whose tiles lost their zone
   (or got a different one) or whose `connCount` is 0 accumulates
   `troubleDays`; at 5 it becomes `abandoned`, empties, and stops counting as
   C/I for land value. Recovery resets the counter. Constructing buildings
   add a day and turn `active` after 3.
2. **Demand** (`computeDemand`, -100..100):
   - R = 25 + 50 × (job capacity incl. under construction − labour force) / max(labour force, 50), clamped, − 5 per R tax point above 9.
   - C = 100 × (0.15 × population − commercial jobs incl. construction) / target, − 4 per C tax point above 9.
   - I = 100 × (20 + 0.25 × population − industrial jobs incl. construction) / target, − 4 per I tax point above 9.
   - Taxes *below* 9 add demand symmetrically.
3. **Spawning** (`dailySpawn`): flushes land value, then per zone takes the
   empty zoned tiles that are `connected`, sorted by index (deterministic),
   and picks `min(4, ceil(demand/25))` of them by weighted sampling without
   replacement (weight = (landValue+1)²). R spawning pauses while more than
   half of existing housing capacity stands empty. Capacity: R 3–7 households
   and C 4–9 jobs (by land value), I 10 jobs.
4. **Occupancy** (`dailyOccupancy`): while R demand > 0, every active R
   building with space gains `1 + floor(demandR/25)` households. If R demand
   < −20, each occupied R building loses one household with probability
   `(−demand−20)/100` (≤ 0.5). Labour force = floor(households × 1.5). If
   workers exceed it, newest employers lay off first; otherwise active C/I
   buildings (alternating C, I by id) hire up to 4 per building per day.
5. **Finances** (`dailyFinances`): income (cents) = households × R% × 15 +
   C jobs × C% × 20 + I jobs × I% × 18; expenses = road upkeep (street 50¢,
   avenue 120¢ per tile per day, highway free). Funds may go negative.
6. **Notifications**: low funds (< $5,000, once per crossing), debt (< $0,
   once per crossing), buildings abandoned, zoned land with no connected
   tiles (at most monthly), unemployment > 25% of labour force ≥ 30 (at most
   monthly).
7. Demand is recomputed with the end-of-day figures so `getStats().demand`
   reflects the city as it now stands.

Spawning and occupancy draw from the single saved RNG in a fixed order, so the
same seed + same commands gives the same city, and a loaded save continues
identically.

## Land value (`landvalue.js`)

`30 + 15` if a road is within 2 tiles (`+ 8` if within 4) `+ 5 per live C
building (max 25) − 6 per live I building (max 30)` within Chebyshev 4,
clamped to 0..100; water is 0. Road changes and C/I building
add/remove/abandon mark the 9×9 window dirty; dirty tiles are recomputed at
the end of each transaction and before spawning. Never a full-map scan after
creation.

## Persistence (`serialize.js`)

Save = `{ format: 'cityfoundry-save', version: 1, ... }` with RLE-encoded
tile arrays (`[value, count, ...]`), buildings as fixed-order integer tuples,
RNG state, clock, money, taxes, demand, alerts, notifications, pending land
value dirty list and chunk versions. `parseSave` validates everything
(format marker, version, sizes, value ranges, run lengths, highway presence,
no road/zone on water, building ids, overlaps and occupancy) and throws
`SaveError` on any problem; derived arrays are rebuilt on load.
