// Persistence and app-level state. Saves and API keys live in localStorage and
// go nowhere else.

import { defaultAiConfig } from '../ai/providers.js';
import { deserialize, serialize } from '../engine/state.js';

const SAVE_KEY = 'pax-sophistc:save';
const CONFIG_KEY = 'pax-sophistc:ai';
const PREFS_KEY = 'pax-sophistc:prefs';

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadAiConfig() {
  return { ...defaultAiConfig(), ...readJson(CONFIG_KEY, {}) };
}

export function saveAiConfig(config) {
  return writeJson(CONFIG_KEY, config);
}

export function loadPrefs() {
  return {
    lastNation: 'usa',
    lastDifficulty: 5,
    lastLength: 40,
    lastWorldMode: 'current',
    theme: 'situation',
    uiScale: 'normal',
    language: 'en',
    seenHelp: false,
    ...readJson(PREFS_KEY, {}),
  };
}

export function savePrefs(prefs) {
  return writeJson(PREFS_KEY, { ...loadPrefs(), ...prefs });
}

export function saveGame(game) {
  try {
    localStorage.setItem(SAVE_KEY, serialize(game));
    return true;
  } catch {
    return false;
  }
}

export function loadGame() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return null;
  try {
    return deserialize(raw);
  } catch {
    return null;
  }
}

export function hasSave() {
  return Boolean(localStorage.getItem(SAVE_KEY));
}

export function clearSave() {
  localStorage.removeItem(SAVE_KEY);
}

/** Download the current run as a JSON file. */
export function exportGame(game) {
  const blob = new Blob([serialize(game)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pax-sophistc-${game.playerId}-q${game.turn}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read a save file the player picked from disk. */
export function importGame(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(deserialize(String(reader.result)));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsText(file);
  });
}
