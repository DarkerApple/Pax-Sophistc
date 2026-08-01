// World modes, map geometry and theme tokens.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { LANDMASSES, OCEANS } from '../src/data/geography.js';
import { NATIONS } from '../src/data/nations.js';
import { createGame, getRelation } from '../src/engine/state.js';
import { advanceTurn } from '../src/engine/turn.js';
import { EVENTS } from '../src/engine/events.js';
import {
  DEFAULT_WORLD_MODE,
  WORLD_MODES,
  WORLD_MODES_BY_ID,
  gameModifiers,
  modePreview,
  worldMode,
} from '../src/engine/worldmodes.js';
import { THEMES, THEMES_BY_ID, UI_SCALES } from '../src/ui/theme.js';
import { VIEW_MODES, alignmentOf, legendFor, project } from '../src/ui/map.js';
import {
  DEFAULT_SCENARIO,
  hasScenario,
  registerScenario,
  scenarioOf,
} from '../src/data/scenarios.js';
import { describeEffects } from '../src/ui/game.js';
import { ACTIONS } from '../src/engine/actions.js';

// ── World modes ────────────────────────────────────────────────────────────

test('every world mode is completely specified', () => {
  const ids = new Set();
  for (const mode of WORLD_MODES) {
    assert.ok(!ids.has(mode.id), `duplicate mode: ${mode.id}`);
    ids.add(mode.id);
    assert.ok(mode.name && mode.blurb && mode.icon, `${mode.id} needs presentation fields`);
    assert.ok(Array.isArray(mode.traits) && mode.traits.length, `${mode.id} needs traits`);
    for (const key of ['eventFrequency', 'eventSeverity', 'warChance', 'relationVolatility', 'revenueBonus']) {
      assert.ok(mode.knobs[key] > 0, `${mode.id}.${key} must be positive`);
    }
    assert.equal(typeof mode.knobs.blackSwans, 'boolean');
    assert.ok(mode.knobs.scrambleRelations >= 0 && mode.knobs.scrambleRelations <= 1);
  }
  assert.ok(WORLD_MODES_BY_ID[DEFAULT_WORLD_MODE], 'the default mode must exist');
  assert.equal(modePreview('chaos').length, 4);
});

test('an unknown mode falls back to the default rather than throwing', () => {
  assert.equal(worldMode('nonsense').id, DEFAULT_WORLD_MODE);
  assert.equal(worldMode(undefined).id, DEFAULT_WORLD_MODE);
});

test('modes are ordered calm → current → chaos on every volatility knob', () => {
  const at = (id) => gameModifiers({ difficulty: 5, worldMode: id });
  const calm = at('calm');
  const current = at('current');
  const chaos = at('chaos');

  assert.ok(calm.eventFrequency < current.eventFrequency);
  assert.ok(current.eventFrequency < chaos.eventFrequency);
  assert.ok(calm.eventSeverity < current.eventSeverity);
  assert.ok(current.eventSeverity < chaos.eventSeverity);
  assert.ok(calm.aiAggression < current.aiAggression);
  assert.ok(current.aiAggression < chaos.aiAggression);
  assert.ok(calm.relationVolatility < chaos.relationVolatility);
  assert.equal(chaos.blackSwans, true);
  assert.equal(calm.blackSwans, false);
  assert.equal(calm.shieldPlayer, true);
});

test('mode and difficulty compose rather than override each other', () => {
  const easyChaos = gameModifiers({ difficulty: 1, worldMode: 'chaos' });
  const hardChaos = gameModifiers({ difficulty: 10, worldMode: 'chaos' });
  const hardCalm = gameModifiers({ difficulty: 10, worldMode: 'calm' });

  assert.ok(hardChaos.aiAggression > easyChaos.aiAggression, 'difficulty still bites inside a mode');
  assert.ok(hardChaos.aiAggression > hardCalm.aiAggression, 'mode still bites at fixed difficulty');
  assert.ok(hardChaos.successPenalty === hardCalm.successPenalty, 'mode must not touch success odds');
});

test('chaos scrambles the starting alignment map; current world does not', () => {
  const current = createGame({ playerNationId: 'fra', seed: 'scramble', mode: 'current' });
  const chaos = createGame({ playerNationId: 'fra', seed: 'scramble', mode: 'chaos' });

  // The anchors are history in Current World.
  assert.equal(getRelation(current, 'rus', 'ukr'), -96);

  let moved = 0;
  for (const key of Object.keys(current.relations)) {
    if (current.relations[key] !== chaos.relations[key]) moved++;
  }
  assert.ok(moved > Object.keys(current.relations).length * 0.8, 'chaos should shake nearly every pair');

  for (const value of Object.values(chaos.relations)) {
    assert.ok(value >= -100 && value <= 100, 'scrambled relations must stay in range');
  }
});

test('world tension starts offset by the mode', () => {
  const calm = createGame({ playerNationId: 'jpn', seed: 't', mode: 'calm' });
  const chaos = createGame({ playerNationId: 'jpn', seed: 't', mode: 'chaos' });
  assert.ok(calm.worldTension < chaos.worldTension);
});

test('black-swan events only exist in chaos', () => {
  const chaosEvents = EVENTS.filter((e) => e.chaosOnly);
  assert.ok(chaosEvents.length >= 5, 'chaos needs its own event pool');

  const seen = { calm: new Set(), chaos: new Set() };
  for (const mode of ['calm', 'chaos']) {
    const game = createGame({ playerNationId: 'idn', difficulty: 5, seed: `swan-${mode}`, totalTurns: 40, mode });
    while (game.status === 'active') {
      const report = advanceTurn(game, {
        orders: [],
        decisionChoice: game.pendingDecision?.choices?.[0]?.id ?? null,
      });
      for (const entry of report.events) seen[mode].add(entry.eventId);
    }
  }
  const chaosIds = new Set(chaosEvents.map((e) => e.id));
  for (const id of seen.calm) {
    assert.ok(!chaosIds.has(id), `black swan ${id} leaked into a calm world`);
  }
  assert.ok([...seen.chaos].some((id) => chaosIds.has(id)), 'chaos should actually fire black swans');
});

test('a chaotic world produces more events than a calm one', () => {
  const count = (mode) => {
    let total = 0;
    const game = createGame({ playerNationId: 'bra', difficulty: 5, seed: `freq-${mode}`, totalTurns: 30, mode });
    while (game.status === 'active') {
      const report = advanceTurn(game, {
        orders: [],
        decisionChoice: game.pendingDecision?.choices?.[0]?.id ?? null,
      });
      total += report.events.length;
    }
    return total;
  };
  const calm = count('calm');
  const chaos = count('chaos');
  assert.ok(chaos > calm * 1.8, `chaos (${chaos}) should clearly out-event calm (${calm})`);
  assert.ok(calm > 0, 'a calm world is quiet, not silent');
});

test('a calm world never springs a surprise war on the player', () => {
  const game = createGame({ playerNationId: 'twn', difficulty: 10, seed: 'shield', totalTurns: 40, mode: 'calm' });
  while (game.status === 'active') {
    advanceTurn(game, { orders: [], decisionChoice: game.pendingDecision?.choices?.[0]?.id ?? null });
  }
  const wasAttacked = game.wars.some((w) => w.defenders.includes('twn'));
  assert.equal(wasAttacked, false, 'Stable World promises no unprovoked war on the player');
});

test('every mode survives a full run without breaking invariants', () => {
  for (const mode of WORLD_MODES) {
    const game = createGame({
      playerNationId: 'nga', difficulty: 8, seed: `run-${mode.id}`, totalTurns: 30, mode: mode.id,
    });
    while (game.status === 'active') {
      advanceTurn(game, {
        orders: [{ actionId: 'reform' }],
        decisionChoice: game.pendingDecision?.choices?.[0]?.id ?? null,
      });
    }
    for (const state of Object.values(game.nations)) {
      assert.ok(state.gdp > 0 && Number.isFinite(state.gdp), `${mode.id}: ${state.id} gdp broke`);
      assert.ok(state.stability >= 0 && state.stability <= 100, `${mode.id}: ${state.id} stability broke`);
    }
    assert.ok(game.worldTension >= 0 && game.worldTension <= 100, `${mode.id}: tension broke`);
  }
});

test('a saved chaotic run round-trips with its mode intact', () => {
  const game = createGame({ playerNationId: 'egy', seed: 'save-mode', mode: 'chaos' });
  advanceTurn(game, { orders: [] });
  const restored = JSON.parse(JSON.stringify(game));
  assert.equal(restored.worldMode, 'chaos');
  assert.equal(gameModifiers(restored).blackSwans, true);
});

// ── Map geography ──────────────────────────────────────────────────────────

test('every landmass ring is a plausible closed polygon', () => {
  const ids = new Set();
  for (const mass of LANDMASSES) {
    assert.ok(!ids.has(mass.id), `duplicate landmass: ${mass.id}`);
    ids.add(mass.id);
    assert.ok(mass.ring.length >= 4, `${mass.id} needs at least four points`);
    for (const [lon, lat] of mass.ring) {
      assert.ok(Number.isFinite(lon) && lon >= -180 && lon <= 180, `${mass.id} longitude out of range: ${lon}`);
      assert.ok(Number.isFinite(lat) && lat >= -90 && lat <= 90, `${mass.id} latitude out of range: ${lat}`);
    }
  }
  assert.ok(LANDMASSES.length >= 20, 'the world needs its major islands too');
});

test('the six inhabited continents are all present', () => {
  const ids = new Set(LANDMASSES.map((m) => m.id));
  for (const required of ['north-america', 'south-america', 'africa', 'eurasia', 'australia']) {
    assert.ok(ids.has(required), `missing landmass: ${required}`);
  }
});

test('ocean labels sit inside the drawn latitude band', () => {
  for (const ocean of OCEANS) {
    assert.ok(ocean.lat <= 84 && ocean.lat >= -58, `${ocean.name} label falls outside the map`);
    assert.ok(ocean.lon >= -180 && ocean.lon <= 180);
  }
});

test('every nation plots inside the drawn map', () => {
  // The map draws latitudes 84N to 58S; a country outside that would vanish.
  for (const nation of NATIONS) {
    assert.ok(nation.lat < 84 && nation.lat > -58, `${nation.id} would fall off the map at lat ${nation.lat}`);
  }
});

test('the projection maps the globe onto the drawing area', () => {
  const [xWest, yNorth] = project(84, -180);
  const [xEast, ySouth] = project(-58, 180);
  assert.equal(Math.round(xWest), 0);
  assert.equal(Math.round(xEast), 1000);
  assert.equal(Math.round(yNorth), 0);
  assert.ok(ySouth > yNorth, 'south must plot below north');

  // Longitude is linear, so a degree is worth the same everywhere.
  const a = project(0, 0)[0];
  const b = project(0, 10)[0];
  const c = project(0, 20)[0];
  assert.ok(Math.abs((b - a) - (c - b)) < 0.001);
});

test('alignment folds ten blocs into three slots plus non-aligned', () => {
  assert.equal(alignmentOf('usa').slot, 1);
  assert.equal(alignmentOf('deu').slot, 1);
  assert.equal(alignmentOf('rus').slot, 2);
  assert.equal(alignmentOf('chn').slot, 2);
  assert.equal(alignmentOf('qat').slot, 3);
  assert.equal(alignmentOf('vnm').slot, 3);
  // Precedence is west → east → regional, so a country in both GCC and BRICS+
  // reads as Eastern-leaning. The fold is lossy by design.
  assert.equal(alignmentOf('sau').slot, 2);
  assert.equal(alignmentOf('che'), null, 'Switzerland is non-aligned');
  assert.equal(alignmentOf('nope'), null);

  // Three categorical slots is the cap an all-pairs colour check allows.
  const slots = new Set(NATIONS.map((n) => alignmentOf(n.id)?.slot).filter(Boolean));
  assert.ok(slots.size <= 3, 'a map may not carry more than three categorical colours');
});

test('every view mode ships a legend, and none is colour-only', () => {
  for (const mode of VIEW_MODES) {
    const legend = legendFor(mode.id);
    assert.ok(legend.length >= 4, `${mode.id} legend is too thin`);
    for (const item of legend) {
      assert.ok(item.fill.startsWith('var(--'), `${mode.id} legend must use theme tokens, got ${item.fill}`);
    }
    assert.ok(legend.some((item) => item.label), `${mode.id} legend needs labels`);
  }
  // Conflict leans on a ring as well as colour, so status is never colour alone.
  assert.ok(legendFor('conflict').some((item) => item.shape === 'ring'));
});

// ── Order previews ─────────────────────────────────────────────────────────

test('order cards explain what an order actually does', () => {
  for (const action of ACTIONS) {
    const pills = describeEffects(action);
    assert.ok(pills.length > 0, `${action.id} shows the player nothing`);
    assert.ok(pills.length <= 5, `${action.id} shows too much`);
    for (const pill of pills) {
      assert.ok(['up', 'down'].includes(pill.dir), `${action.id} pill needs a direction`);
      assert.ok(/[+−]/.test(pill.text), `${action.id} pill needs a sign: ${pill.text}`);
      assert.ok(!/undefined|NaN/.test(pill.text), `${action.id} pill is broken: ${pill.text}`);
    }
  }
});

test('rising unrest reads as bad even though the number goes up', () => {
  const crackdown = ACTIONS.find((a) => a.id === 'crackdown');
  const unrestPill = describeEffects(crackdown).find((p) => p.text.startsWith('Unrest'));
  assert.ok(unrestPill.text.includes('−'), 'a crackdown lowers unrest');
  assert.equal(unrestPill.dir, 'up', 'lower unrest is a good outcome');
});

// ── Themes ─────────────────────────────────────────────────────────────────

test('every theme is complete and declares a colour scheme', () => {
  const ids = new Set();
  for (const theme of THEMES) {
    assert.ok(!ids.has(theme.id), `duplicate theme: ${theme.id}`);
    ids.add(theme.id);
    assert.ok(theme.name && theme.blurb, `${theme.id} needs a name and blurb`);
    assert.ok(['light', 'dark'].includes(theme.scheme), `${theme.id} bad scheme`);
    assert.equal(theme.swatch.length, 3, `${theme.id} needs three preview swatches`);
    for (const hex of theme.swatch) assert.match(hex, /^#[0-9a-f]{6}$/i);
  }
  assert.ok(THEMES.some((t) => t.scheme === 'light'), 'at least one light theme');
  assert.ok(THEMES_BY_ID.contrast, 'a high-contrast theme must exist');
  assert.ok(UI_SCALES.every((s) => s.factor > 0));
});

test('every theme defines the full token set the UI reads', () => {
  const css = readFileSync(new URL('../styles/main.css', import.meta.url), 'utf8');
  const required = [
    '--bg', '--panel', '--panel-2', '--line', '--ink', '--muted', '--muted-2',
    '--accent', '--accent-ink', '--good', '--warn', '--bad',
    '--map-surface', '--map-land', '--map-land-edge', '--map-grid', '--map-ink',
  ];

  for (const theme of THEMES) {
    // The default theme shares its block with the bare :root selector.
    const marker = theme.id === 'situation' ? ":root[data-theme='situation']" : `:root[data-theme='${theme.id}']`;
    const start = css.indexOf(marker);
    assert.ok(start !== -1, `no CSS block for theme ${theme.id}`);
    const block = css.slice(start, css.indexOf('}', start));
    for (const token of required) {
      assert.ok(block.includes(`${token}:`), `theme ${theme.id} is missing ${token}`);
    }
  }
});

test('both data palettes define every visualisation token', () => {
  const css = readFileSync(new URL('../styles/main.css', import.meta.url), 'utf8');
  const tokens = [
    '--dv-seq-1', '--dv-seq-2', '--dv-seq-3', '--dv-seq-4', '--dv-seq-5',
    '--dv-positive', '--dv-negative', '--dv-neutral',
    '--dv-cat-1', '--dv-cat-2', '--dv-cat-3',
  ];
  for (const scheme of ['dark', 'light']) {
    const start = css.indexOf(`:root[data-scheme='${scheme}']`);
    assert.ok(start !== -1, `no data palette for ${scheme}`);
    const block = css.slice(start, css.indexOf('}', start));
    for (const token of tokens) {
      assert.ok(block.includes(`${token}:`), `${scheme} palette missing ${token}`);
    }
  }
  // Status colours are reserved and defined once, never per theme.
  for (const token of ['--st-good', '--st-warning', '--st-serious', '--st-critical']) {
    assert.ok(css.includes(`${token}:`), `missing reserved status token ${token}`);
  }
});

// ── Scenarios ───────────────────────────────────────────────────────────────

test('the current world is registered as a scenario and is the default', () => {
  assert.ok(hasScenario(DEFAULT_SCENARIO));
  const world = scenarioOf(DEFAULT_SCENARIO);
  assert.equal(world.startYear, 2026);
  assert.equal(world.nations.length, NATIONS.length);
  assert.ok(world.anchors.length > 0, 'the current world needs its historical anchors');
});

test('an unknown scenario falls back rather than throwing', () => {
  assert.equal(scenarioOf('bronze-age').id, DEFAULT_SCENARIO);
});

test('a scenario pack can add a whole different era without touching the engine', () => {
  // This is the shape an old-world mode will arrive in.
  registerScenario({
    id: 'test-era',
    name: 'Test Era',
    startYear: 1450,
    nations: [
      {
        id: 'test-a', name: 'Aland', adjective: 'Alandic', flag: '🏳', lat: 50, lon: 10,
        region: 'western-europe', government: 'Monarchy', leaderTitle: 'King',
        area: 400, population: 4, gdp: 0.02, growth: 0.2, military: 30, readiness: 50,
        tech: 20, stability: 55, influence: 20, unrest: 30, nukes: 0, blocs: [],
        doctrine: 'fortress', tags: [], brief: 'A test polity.',
      },
      {
        id: 'test-b', name: 'Bland', adjective: 'Blandic', flag: '🏳', lat: 45, lon: 5,
        region: 'western-europe', government: 'Republic', leaderTitle: 'Doge',
        area: 200, population: 2, gdp: 0.03, growth: 0.3, military: 20, readiness: 60,
        tech: 25, stability: 60, influence: 25, unrest: 20, nukes: 0, blocs: [],
        doctrine: 'trader', tags: [], brief: 'Another test polity.',
      },
    ],
    anchors: [['test-a', 'test-b', -40]],
  });

  const game = createGame({ playerNationId: 'test-a', scenario: 'test-era', seed: 'era' });
  assert.equal(game.scenario, 'test-era');
  assert.equal(game.year, 1450);
  assert.deepEqual(Object.keys(game.nations).sort(), ['test-a', 'test-b']);
  assert.equal(getRelation(game, 'test-a', 'test-b'), -40, 'the pack\'s anchors must be used');

  // And the whole quarter runs against it — this is the point of the seam.
  const report = advanceTurn(game, { orders: [{ actionId: 'stimulus' }] });
  assert.equal(report.turn, 1);
  assert.equal(game.status, 'active');
});
