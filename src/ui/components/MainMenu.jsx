import { useEffect, useState } from 'react';
import { createSimulation } from '../../sim/index.js';
import { listSaves, loadCity, deleteSave, AUTOSAVE_SLOT } from '../../sim/storage.js';
import { formatInt, formatMoney, formatRelative } from '../format.js';
import { SitePlan } from './SitePlan.jsx';

function randomSeed() {
  return Math.floor(Math.random() * 900000) + 100000;
}

function parseSeed(s) {
  const t = String(s).trim();
  if (t === '') return null;
  return /^-?\d+$/.test(t) ? Number(t) : t;
}

export function MainMenu({ onStart }) {
  const [name, setName] = useState('Foundry Flats');
  const [seed, setSeed] = useState(() => String(randomSeed()));
  const [saves, setSaves] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    listSaves()
      .then(setSaves)
      .catch((e) => {
        setSaves([]);
        setError(`Saved cities are unavailable: ${e.message || e}`);
      });

  useEffect(() => {
    refresh();
  }, []);

  const autosave = saves && saves.find((s) => s.slot === AUTOSAVE_SLOT);
  const named = saves ? saves.filter((s) => s.slot !== AUTOSAVE_SLOT) : [];

  const create = (e) => {
    e.preventDefault();
    const sd = parseSeed(seed);
    const nm = name.trim() || 'New City';
    if (sd == null) return setError('Enter a seed, or roll a new one.');
    try {
      onStart(createSimulation({ name: nm, seed: sd }));
    } catch (err) {
      setError(`Could not found the city: ${err.message}`);
    }
  };

  const load = async (slot) => {
    setBusy(true);
    setError(null);
    try {
      const sim = await loadCity(slot);
      onStart(sim);
    } catch (err) {
      setError(`That save could not be loaded: ${err.message}`);
      setBusy(false);
    }
  };

  const remove = async (slot) => {
    try {
      await deleteSave(slot);
    } catch (err) {
      setError(`Could not delete the save: ${err.message}`);
    }
    refresh();
  };

  return (
    <main className="menu">
      <div className="menu-grid" aria-hidden="true" />
      <section className="menu-left">
        <header className="wordmark">
          <h1>
            City<span>Foundry</span>
          </h1>
          <p>Lay roads off the highway, zone the land, and watch a town pour itself into the grid.</p>
        </header>

        {autosave && (
          <button className="btn btn-primary continue" onClick={() => load(AUTOSAVE_SLOT)} disabled={busy} data-testid="continue">
            <span className="continue-title">Continue {autosave.name}</span>
            <span className="continue-meta">
              {formatInt(autosave.population)} residents, {formatMoney(autosave.funds)}, autosaved {formatRelative(autosave.savedAt)}
            </span>
          </button>
        )}

        <form className="plate new-city" onSubmit={create} aria-labelledby="new-city-h">
          <h2 id="new-city-h">New city</h2>
          <label className="field">
            <span>City name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} data-testid="city-name" autoComplete="off" />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Map seed</span>
              <input value={seed} onChange={(e) => setSeed(e.target.value)} maxLength={24} data-testid="city-seed" autoComplete="off" />
            </label>
            <button type="button" className="btn btn-ghost" onClick={() => setSeed(String(randomSeed()))}>
              Roll seed
            </button>
          </div>
          <button type="submit" className={autosave ? 'btn' : 'btn btn-primary'} data-testid="found-city">
            Found city
          </button>
        </form>

        <section className="plate saves" aria-labelledby="saves-h">
          <h2 id="saves-h">Saved cities</h2>
          {saves == null && <p className="muted">Reading saves…</p>}
          {saves && named.length === 0 && <p className="muted">No saved cities yet. Save from the top bar while you play.</p>}
          {named.length > 0 && (
            <ul className="save-list" data-testid="save-list">
              {named.map((s) => (
                <li key={s.slot}>
                  <button className="save-load" onClick={() => load(s.slot)} disabled={busy} data-testid="load-save">
                    <span className="save-name">{s.name}</span>
                    <span className="save-meta">
                      {formatInt(s.population)} residents, {formatMoney(s.funds)}, saved {formatRelative(s.savedAt)}
                    </span>
                  </button>
                  <button className="btn-icon" onClick={() => remove(s.slot)} aria-label={`Delete save ${s.name}`} title="Delete save">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {error && (
          <p className="menu-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <section className="menu-right">
        <SitePlan seed={parseSeed(seed) ?? 0} label={`Site survey, seed ${seed || '—'}: 128 × 128 tiles, lakes in blue, highway in orange`} />
      </section>
    </main>
  );
}
