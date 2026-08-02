// The translation layer, and the promise that an untranslated string still
// renders real prose rather than a raw key.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { NATIONS } from '../src/data/nations.js';
import { ACTIONS } from '../src/engine/actions.js';
import { CATEGORIES } from '../src/engine/actions.js';
import { WORLD_MODES } from '../src/engine/worldmodes.js';
import { EVENTS } from '../src/engine/events.js';
import { causeIds } from '../src/engine/causes.js';
import { THEMES, UI_SCALES } from '../src/ui/theme.js';
import { KO } from '../src/i18n/ko.js';
import {
  LANGUAGES,
  currentLanguage,
  setLanguage,
  t,
  tAction,
  tLabel,
  tModifier,
  tNation,
  tStat,
} from '../src/i18n/index.js';

test.afterEach(() => setLanguage('en'));

test('English is the default and every language is declared', () => {
  assert.equal(currentLanguage(), 'en');
  assert.ok(LANGUAGES.some((l) => l.id === 'en'));
  assert.ok(LANGUAGES.some((l) => l.id === 'ko'));
  for (const lang of LANGUAGES) {
    assert.ok(lang.name && lang.native, `${lang.id} needs both names`);
  }
});

test('an unknown language falls back to English rather than breaking', () => {
  setLanguage('klingon');
  assert.equal(currentLanguage(), 'en');
});

test('t() returns the English fallback when a key is missing', () => {
  setLanguage('ko');
  assert.equal(t('this.key.does.not.exist', 'Fallback prose'), 'Fallback prose');
  // And never leaks a raw key when there is no fallback either.
  assert.equal(t('another.missing.key'), 'another.missing.key');
});

test('t() interpolates variables in both languages', () => {
  assert.equal(t('x.y', 'Quarter {turn} of {total}', { turn: 3, total: 40 }), 'Quarter 3 of 40');
  setLanguage('ko');
  const text = t('hud.dateHint', 'Quarter {turn} of {total}', { turn: 3, total: 40 });
  assert.ok(text.includes('3') && text.includes('40'), 'numbers must survive translation');
  assert.ok(!text.includes('{'), `unreplaced placeholder in: ${text}`);
});

test('every country is fully translated into Korean', () => {
  setLanguage('ko');
  for (const nation of NATIONS) {
    const entry = KO.nations[nation.id];
    assert.ok(entry, `no Korean entry for ${nation.id}`);
    for (const field of ['name', 'government', 'leaderTitle', 'brief']) {
      assert.ok(entry[field], `${nation.id} is missing a Korean ${field}`);
      assert.equal(tNation(nation, field), entry[field]);
    }
    assert.notEqual(tNation(nation), nation.name, `${nation.id} name was left in English`);
  }
});

test('every order is fully translated into Korean', () => {
  setLanguage('ko');
  for (const action of ACTIONS) {
    const entry = KO.actions[action.id];
    assert.ok(entry, `no Korean entry for order ${action.id}`);
    assert.ok(entry.name && entry.blurb, `${action.id} needs a Korean name and blurb`);
    assert.equal(tAction(action), entry.name);
    assert.equal(tAction(action, 'blurb'), entry.blurb);
  }
});

test('a freeform order keeps the words the player typed', () => {
  setLanguage('ko');
  const custom = { id: 'custom-order', name: 'Buy the lithium', blurb: 'x' };
  assert.equal(tAction(custom), 'Buy the lithium');
});

test('categories, modes, themes and text sizes are all translated', () => {
  setLanguage('ko');
  for (const c of CATEGORIES) {
    assert.ok(KO.categories[c.id], `category ${c.id} is untranslated`);
    assert.equal(tLabel('categories', c.id, c.name), KO.categories[c.id]);
  }
  for (const m of WORLD_MODES) {
    assert.ok(KO.modes[m.id]?.name, `mode ${m.id} is untranslated`);
    assert.equal(KO.modes[m.id].traits.length, m.traits.length, `mode ${m.id} trait count differs`);
  }
  for (const theme of THEMES) assert.ok(KO.themes[theme.id]?.name, `theme ${theme.id} is untranslated`);
  for (const scale of UI_SCALES) assert.ok(KO.scales[scale.id], `text size ${scale.id} is untranslated`);
});

test('every event has a Korean title and body', () => {
  setLanguage('ko');
  const source = readFileSync(new URL('../src/i18n/ko.js', import.meta.url), 'utf8');
  for (const event of EVENTS) {
    assert.ok(source.includes(`'eventTitle.${event.id}'`), `event ${event.id} has no Korean title`);
    if (event.kind === 'decision') {
      assert.ok(source.includes(`'decision.${event.id}.prompt'`), `decision ${event.id} has no Korean prompt`);
      continue;
    }
    // An event either has one body or a set of variants keyed 'event.<id>.<variant>'.
    const single = source.includes(`'event.${event.id}':`);
    const variants = source.includes(`'event.${event.id}.`);
    assert.ok(single || variants, `event ${event.id} body is untranslated`);
  }
});

test('every reason an event can give is translated', () => {
  const source = readFileSync(new URL('../src/i18n/ko.js', import.meta.url), 'utf8');
  const missing = causeIds().filter((id) => !source.includes(`'cause.${id}'`));
  assert.deepEqual(missing, [], `untranslated causes: ${missing.join(', ')}`);
});

test('stat names used inside generated prose are translated', () => {
  setLanguage('ko');
  for (const field of ['stability', 'unrest', 'approval', 'military', 'tech', 'influence', 'treasury']) {
    assert.ok(KO.statWords[field], `stat word ${field} is untranslated`);
    assert.equal(tStat(field), KO.statWords[field]);
  }
});

test('ongoing-effect labels survive a save round-trip and still translate', () => {
  setLanguage('ko');
  // Saves store the English label, so translation is a lookup, not a key.
  assert.equal(tModifier('War economy'), KO.modifiers['War economy']);
  // An unknown label degrades to itself rather than to a blank.
  assert.equal(tModifier('Something Invented Later'), 'Something Invented Later');
});

test('every ongoing effect an order can create has a Korean label', () => {
  const labels = new Set();
  for (const action of ACTIONS) {
    for (const tier of ['success', 'failure', 'backfire']) {
      for (const key of ['modifier', 'targetModifier']) {
        const label = action.effects?.[tier]?.[key]?.label;
        if (label) labels.add(label);
      }
    }
  }
  const missing = [...labels].filter((label) => !KO.modifiers[label]);
  assert.deepEqual(missing, [], `untranslated ongoing effects: ${missing.join(', ')}`);
});

test('switching language changes the output and switching back restores it', () => {
  const nation = NATIONS.find((n) => n.id === 'kor');
  const english = tNation(nation);
  setLanguage('ko');
  const korean = tNation(nation);
  setLanguage('en');
  assert.equal(tNation(nation), english);
  assert.notEqual(korean, english);
  assert.equal(korean, '대한민국');
});

test('no Korean string leaves a placeholder that nothing fills', () => {
  // Every {placeholder} in a Korean string must exist in its English source,
  // otherwise it renders literally to the player.
  const allowed = new Set([
    'turn', 'total', 'n', 'pct', 'amount', 'money', 'pc', 'action', 'target', 'reason',
    'nation', 'a', 'b', 'joiner', 'friend', 'title', 'label', 'turns', 'stat',
    'headline', 'growth', 'gdp', 'revenue', 'upkeep', 'tension', 'date', 'deltas',
    'notes', 'odds', 'cost', 'outcome', 'help', 'drag', 'hurt', 'list', 'other',
    'brief', 'pop', 'stability', 'unrest', 'tech', 'treasury', 'friends', 'rivals',
    'weakness', 'mode', 'tier', 'blurb', 'objectives', 'winner', 'quarters',
    'casualties', 'war', 'odds', 'text',
    'child', 'parent', 'pct', 'seller', 'buyer', 'price', 'bloc', 'km',
    // Figures generated by events, passed through as template variables.
    'dead', 'displaced', 'injured', 'cases', 'districts', 'evacuated', 'mw',
    'nights', 'arrests', 'crowd', 'cities', 'fighters', 'days', 'workers',
    'fall', 'rate', 'down', 'priceUp', 'hours', 'delta', 'left', 'list',
    'victim', 'winner', 'joiner', 'aggressor',
    // The world panel and the country file.
    'year', 'q', 'all', 'category', 'up', 'rev',
    // Factions, the rivalry, the constitution, the congress and the ending.
    'faction', 'v', 'm', 'setting', 'clause', 'ordinal', 'fee', 'seed',
    'next', 'prev', 'turns', 'share', 'c', 'from', 'to', 'names', 'more', 'pronoun',
    'terms', 'shape', 'above', 'direction', 'origin', 'ended', 'codename', 'rival',
    // Treaties, allies and war names.
    'kind', 'caller', 'r', 'theatre', 'adj', 'defender', 'season', 'base', 'year',
    'name', 'ordinal', 'c', 'from', 'to', 'slots', 'lever',
  ]);
  for (const [key, value] of Object.entries(KO.ui)) {
    if (typeof value !== 'string') continue;
    for (const match of value.matchAll(/\{(\w+)\}/g)) {
      assert.ok(allowed.has(match[1]), `unknown placeholder {${match[1]}} in Korean key ${key}`);
    }
  }
});
