// Translation layer.
//
// English lives in the data and UI files as the source of truth; a language
// pack supplies overrides keyed by id. Anything a pack does not translate falls
// back to English rather than showing a raw key, so a partial translation
// degrades gracefully instead of breaking the screen.

import { KO } from './ko.js';

export const LANGUAGES = [
  { id: 'en', name: 'English', native: 'English' },
  { id: 'ko', name: 'Korean', native: '한국어' },
];

const PACKS = { ko: KO };

let current = 'en';
const listeners = new Set();

export function currentLanguage() {
  return current;
}

export function setLanguage(id) {
  current = LANGUAGES.some((l) => l.id === id) ? id : 'en';
  if (typeof document !== 'undefined') document.documentElement.lang = current;
  for (const fn of listeners) fn(current);
  return current;
}

export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function pack() {
  return PACKS[current] || null;
}

/**
 * Interface string by key. `vars` are interpolated as {name}.
 * The English text is passed in as the fallback so callers read naturally and
 * an untranslated key still renders real prose.
 */
export function t(key, fallback, vars) {
  const dict = pack()?.ui;
  let text = (dict && dict[key]) ?? fallback ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

/** Country name, adjective, government or one-line brief. */
export function tNation(def, field = 'name') {
  if (!def) return '';
  return pack()?.nations?.[def.id]?.[field] ?? def[field] ?? '';
}

/** Order name or blurb. */
export function tAction(action, field = 'name') {
  if (!action) return '';
  // Freeform orders carry the player's own words; never translate those.
  if (action.id === 'custom-order' && field === 'name') return action.name;
  return pack()?.actions?.[action.id]?.[field] ?? action[field] ?? '';
}

/** Generic id-keyed lookup for the smaller vocabularies. */
export function tIn(group, id, field, fallback) {
  return pack()?.[group]?.[id]?.[field] ?? fallback ?? '';
}

/** A stat, category, tier, theme or view-mode label. */
export function tLabel(group, id, fallback) {
  const value = pack()?.[group]?.[id];
  if (typeof value === 'string') return value;
  return value?.name ?? fallback ?? id;
}

/**
 * Ongoing-effect labels are stored in saves as English strings, so they are
 * translated by lookup rather than by key.
 */
export function tModifier(label) {
  return pack()?.modifiers?.[label] ?? label;
}

/** A stat name used inside generated prose ("stability", "unrest"). */
export function tStat(field) {
  return pack()?.statWords?.[field] ?? field;
}

/** True when the active language reads better without spaces before units. */
export function isKorean() {
  return current === 'ko';
}
