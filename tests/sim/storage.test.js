// storage.js against fake-indexeddb (a real IndexedDB implementation for Node).
// Skipped automatically when fake-indexeddb is not installed (e.g. the Node
// fallback runner in an offline sandbox).
import { describe, it, expect, beforeEach } from 'vitest';
import { createSimulation, SaveError } from '../../src/sim/index.js';
import { saveCity, loadCity, listSaves, deleteSave, AUTOSAVE_SLOT } from '../../src/sim/storage.js';

let IDBFactory = null;
try {
  ({ IDBFactory } = await import('fake-indexeddb'));
} catch {
  IDBFactory = null;
}

const suite = IDBFactory ? describe : describe.skip;

suite('storage (IndexedDB)', () => {
  let factory;
  beforeEach(() => {
    factory = new IDBFactory(); // fresh, empty database per test
  });

  it('saves, lists, loads and deletes cities', async () => {
    const sim = createSimulation({ seed: 11, name: 'Savetown' });
    const y = sim.getWorld().outsideConnection.y;
    sim.placeRoad({ x: 6, y }, { x: 20, y });
    sim.step(30);
    const summary = await saveCity('slot1', sim, { factory });
    expect(summary.slot).toBe('slot1');
    expect(summary.name).toBe('Savetown');
    expect(summary.funds).toBe(sim.getStats().funds);

    await saveCity(AUTOSAVE_SLOT, createSimulation({ seed: 12, name: 'Auto' }), { factory });
    const list = await listSaves({ factory });
    expect(list.map((s) => s.slot).sort()).toEqual(['autosave', 'slot1']);
    for (const s of list) expect(Object.keys(s).sort()).toEqual(['funds', 'name', 'population', 'savedAt', 'slot']);

    const loaded = await loadCity('slot1', { factory });
    expect(loaded.getStats()).toEqual(sim.getStats());
    expect(loaded.getTime()).toEqual(sim.getTime());
    expect(loaded.getTile(10, y)).toEqual(sim.getTile(10, y));

    await deleteSave('slot1', { factory });
    expect((await listSaves({ factory })).map((s) => s.slot)).toEqual(['autosave']);
  });

  it('overwrites an existing slot', async () => {
    await saveCity('a', createSimulation({ seed: 1, name: 'One' }), { factory });
    await saveCity('a', createSimulation({ seed: 2, name: 'Two' }), { factory });
    const list = await listSaves({ factory });
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Two');
  });

  it('loading a missing slot rejects with SaveError; bad slot names throw', async () => {
    await expect(loadCity('missing', { factory })).rejects.toThrow(SaveError);
    await expect(saveCity('', createSimulation({ seed: 1 }), { factory })).rejects.toThrow(TypeError);
  });
});
