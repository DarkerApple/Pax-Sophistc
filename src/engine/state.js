// Game state construction, serialisation, and the small helpers every other
// engine module leans on.

import { NATIONS_BY_ID, powerRank, registerNation } from '../data/nations.js';
import { DEFAULT_SCENARIO, scenarioOf } from '../data/scenarios.js';
import { Rng, hashSeed } from './rng.js';
import { clampDifficulty } from './difficulty.js';
import { worldMode } from './worldmodes.js';
import { createTerritory } from './territory.js';

export const SAVE_VERSION = 1;
export const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
export const START_YEAR = 2026;

export function clamp(value, min = 0, max = 100) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function relationKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function getRelation(game, a, b) {
  if (a === b) return 100;
  const value = game.relations[relationKey(a, b)];
  return value === undefined ? 0 : value;
}

export function setRelation(game, a, b, value) {
  if (a === b) return;
  game.relations[relationKey(a, b)] = clamp(Math.round(value), -100, 100);
}

export function adjustRelation(game, a, b, delta) {
  if (a === b || !delta) return;
  setRelation(game, a, b, getRelation(game, a, b) + delta);
}

/** Great-circle-ish distance in kilometres, used for proximity effects. */
export function distanceKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 1 for neighbours, decaying to ~0 for antipodes. */
export function proximity(a, b) {
  const km = distanceKm(a, b);
  return Math.max(0, 1 - km / 9000);
}

function sharedBlocs(a, b) {
  return (a.blocs || []).filter((bloc) => (b.blocs || []).includes(bloc));
}

/**
 * Seed the relation matrix: bloc membership and geography set the baseline,
 * then the historical anchors overwrite the pairs the real world has settled.
 */
function buildRelations(roster, anchors, rng, scramble = 0) {
  const relations = {};
  for (let i = 0; i < roster.length; i++) {
    for (let j = i + 1; j < roster.length; j++) {
      const a = roster[i];
      const b = roster[j];
      const shared = sharedBlocs(a, b);
      let value = 4;
      value += shared.length * 26;
      // Neighbours are simply more entangled — for good and ill.
      value += (proximity(a, b) - 0.35) * 14;
      // Similar governments trend friendlier.
      if (a.government === b.government) value += 6;
      relations[relationKey(a.id, b.id)] = clamp(Math.round(value), -100, 100);
    }
  }
  for (const [a, b, value] of anchors) {
    if (NATIONS_BY_ID[a] && NATIONS_BY_ID[b]) {
      relations[relationKey(a, b)] = clamp(value, -100, 100);
    }
  }

  // Chaotic worlds start with the alignment map shaken: old friends are not
  // reliably friends, and old enemies are not reliably enemies.
  if (scramble > 0 && rng) {
    for (const key of Object.keys(relations)) {
      const jolt = rng.normal(0, 70 * scramble);
      relations[key] = clamp(Math.round(relations[key] * (1 - scramble * 0.55) + jolt), -100, 100);
    }
  }
  return relations;
}

function initialNationState(def) {
  return {
    id: def.id,
    gdp: def.gdp,
    baseGrowth: def.growth,
    population: def.population,
    treasury: Math.round(def.gdp * 1000 * 0.05),
    military: def.military,
    readiness: def.readiness,
    tech: def.tech,
    stability: def.stability,
    influence: def.influence,
    unrest: def.unrest,
    nukes: def.nukes,
    approval: clamp(def.stability - def.unrest * 0.3 + 12),
    modifiers: [],
    atWarWith: [],
    sanctionedBy: [],
    doctrine: def.doctrine,
    lastAction: null,
    history: [{
      turn: 0,
      gdp: def.gdp,
      military: def.military,
      stability: def.stability,
      readiness: def.readiness,
      tech: def.tech,
      unrest: def.unrest,
      approval: clamp(def.stability - def.unrest * 0.3 + 12),
      influence: def.influence,
      treasury: Math.round(def.gdp * 1000 * 0.05),
      population: Math.round(def.population),
    }],
  };
}

/**
 * The player's standing goals. These are what the end-of-run grade is measured
 * against, and what the AI narrator is told to write toward.
 */
function buildObjectives(def) {
  const objectives = [
    {
      id: 'prosperity',
      title: 'Grow the economy',
      detail: `Finish with ${def.name}'s GDP at least 8% above its starting level.`,
      metric: 'gdpGrowth',
      target: 0.08,
    },
    {
      id: 'stability',
      title: 'Hold the country together',
      detail: 'Never let stability fall below 30, and finish above 55.',
      metric: 'stabilityFloor',
      target: 55,
    },
    {
      id: 'standing',
      title: 'Raise your standing',
      detail: 'Finish with higher global influence than you started with.',
      metric: 'influenceGain',
      target: 0,
    },
  ];

  // Only the genuine great powers are graded on keeping the system stable;
  // everyone else is graded on surviving it. (Power ranks run ~58-180.)
  if (powerRank(def) >= 124) {
    objectives.push({
      id: 'order',
      title: 'Keep the peace you profit from',
      detail: 'End the run with world tension below 60 and no great-power war ongoing.',
      metric: 'tensionCeiling',
      target: 60,
    });
  } else {
    objectives.push({
      id: 'survival',
      title: 'Survive the great-power squeeze',
      detail: 'Avoid being drawn into a war you did not start, or win it if you are.',
      metric: 'warOutcome',
      target: 0,
    });
  }
  return objectives;
}

function startingPoliticalCapital(difficulty) {
  // Kept local so state.js does not have to import the whole modifier stack.
  const t = (clampDifficulty(difficulty) - 1) / 9;
  return Math.round(2 - 4 * t);
}

export function createGame({
  playerNationId = 'usa',
  difficulty = 5,
  seed = null,
  totalTurns = 40,
  scenario = DEFAULT_SCENARIO,
  mode = 'current',
} = {}) {
  // The roster comes from the scenario, never from an import, so a second era
  // is a data pack rather than an engine change.
  const world = scenarioOf(scenario);
  const roster = world.nations;
  if (!roster.some((n) => n.id === playerNationId)) {
    throw new Error(`Unknown nation: ${playerNationId}`);
  }
  const resolvedSeed = seed === null || seed === '' ? String(Math.floor(Math.random() * 1e9)) : String(seed);
  const rng = new Rng(hashSeed(resolvedSeed));
  const def = NATIONS_BY_ID[playerNationId];

  const nations = {};
  for (const nation of roster) nations[nation.id] = initialNationState(nation);

  const knobs = worldMode(mode).knobs;

  const game = {
    version: SAVE_VERSION,
    scenario: world.id,
    worldMode: worldMode(mode).id,
    seed: resolvedSeed,
    rngState: rng.state,
    createdAt: new Date().toISOString(),
    difficulty: clampDifficulty(difficulty),
    playerId: playerNationId,
    turn: 0,
    totalTurns,
    year: world.startYear,
    quarter: 0,
    worldTension: clamp(42 + knobs.tensionOffset, 0, 100),
    globalGrowth: 1,
    nations,
    relations: buildRelations(roster, world.anchors, rng, knobs.scrambleRelations),
    wars: [],
    treaties: [],
    // Only the cells that have changed hands are stored; the starting map is
    // recomputed from geography, so saves stay small.
    territory: createTerritory(),
    // States that did not exist at the start of the run — breakaways, unions,
    // successor republics. Keyed the same way as the roster.
    customNations: {},
    // Bloc membership is a live fact, not a fixed attribute: countries join and
    // leave. Seeded from the roster, then edited by play.
    blocMembership: Object.fromEntries(roster.map((n) => [n.id, [...(n.blocs || [])]])),
    // Per-pair escalation ladders, keyed like relations.
    escalation: {},
    log: [],
    headlines: [],
    turnReports: [],
    objectives: buildObjectives(def),
    politicalCapital: 6 + startingPoliticalCapital(difficulty),
    status: 'active', // active | victory | defeat | collapsed
    ending: null,
    startSnapshot: {
      gdp: def.gdp,
      influence: def.influence,
      stability: def.stability,
      military: def.military,
    },
    stats: { actionsTaken: 0, warsStarted: 0, warsWon: 0, crisesResolved: 0, nukesUsed: 0 },
  };

  return game;
}

/** Restore the RNG for a turn, then write its state back onto the game. */
export function withRng(game, fn) {
  const rng = Rng.fromState(game.rngState);
  const result = fn(rng);
  game.rngState = rng.state;
  return result;
}

export function playerNation(game) {
  return game.nations[game.playerId];
}

export function nationDef(id) {
  return NATIONS_BY_ID[id];
}

/**
 * The definition sheet for any state in play, including ones invented mid-run.
 * Use this rather than NATIONS_BY_ID anywhere a breakaway could turn up.
 */
export function defOf(game, id) {
  return NATIONS_BY_ID[id] || game?.customNations?.[id] || null;
}

/** Blocs a country belongs to *now*, which is not always what it started in. */
export function blocsOf(game, id) {
  const live = game?.blocMembership?.[id];
  if (live) return live;
  return defOf(game, id)?.blocs || [];
}

export function inBloc(game, id, blocId) {
  return blocsOf(game, id).includes(blocId);
}

/** Join a bloc. Returns true when it was actually a change. */
export function joinBloc(game, id, blocId) {
  if (!game.blocMembership) game.blocMembership = {};
  const list = game.blocMembership[id] || (game.blocMembership[id] = []);
  if (list.includes(blocId)) return false;
  list.push(blocId);
  return true;
}

/** Leave a bloc. Returns true when it was actually a change. */
export function leaveBloc(game, id, blocId) {
  const list = game?.blocMembership?.[id];
  if (!list) return false;
  const at = list.indexOf(blocId);
  if (at < 0) return false;
  list.splice(at, 1);
  return true;
}

export function dateLabel(game) {
  return `${QUARTERS[game.quarter]} ${game.year}`;
}

/** Nations sorted by live in-game power rather than by their starting sheet. */
export function rankedNations(game) {
  return Object.values(game.nations)
    .map((state) => ({ state, def: NATIONS_BY_ID[state.id], power: livePower(game, state.id) }))
    .sort((a, b) => b.power - a.power);
}

export function livePower(game, id) {
  const state = game.nations[id];
  const def = NATIONS_BY_ID[id];
  if (!state || !def) return 0;
  return (
    Math.log10(Math.max(state.gdp, 0.01) * 1000) * 14 +
    state.military * 0.6 +
    state.influence * 0.35 +
    state.tech * 0.2 +
    Math.min(state.nukes, 500) * 0.01
  );
}

/** Effective military strength for war maths. */
export function combatPower(game, id) {
  const state = game.nations[id];
  if (!state) return 0;
  const economy = Math.min(2.2, 0.55 + Math.log10(Math.max(state.gdp, 0.02) * 1000) / 4.2);
  return (
    state.military *
    (0.45 + state.readiness / 180) *
    (0.75 + state.tech / 320) *
    economy *
    (0.7 + state.stability / 320)
  );
}

export function allies(game, id) {
  return Object.keys(game.nations).filter(
    (other) => other !== id && getRelation(game, id, other) >= 55,
  );
}

export function rivals(game, id) {
  return Object.keys(game.nations).filter(
    (other) => other !== id && getRelation(game, id, other) <= -35,
  );
}

export function isAtWar(game, a, b) {
  return game.wars.some(
    (war) =>
      war.active &&
      ((war.attackers.includes(a) && war.defenders.includes(b)) ||
        (war.attackers.includes(b) && war.defenders.includes(a))),
  );
}

export function activeWarsFor(game, id) {
  return game.wars.filter(
    (war) => war.active && (war.attackers.includes(id) || war.defenders.includes(id)),
  );
}

/** Add a temporary modifier that decays over `turns` turns. */
export function addModifier(game, nationId, modifier) {
  const state = game.nations[nationId];
  if (!state) return;
  state.modifiers.push({
    id: modifier.id || `mod-${game.turn}-${state.modifiers.length}`,
    label: modifier.label || 'Ongoing effect',
    turnsLeft: modifier.turns ?? 4,
    growth: modifier.growth || 0,
    stability: modifier.stability || 0,
    unrest: modifier.unrest || 0,
    influence: modifier.influence || 0,
    readiness: modifier.readiness || 0,
    tech: modifier.tech || 0,
    revenue: modifier.revenue || 0,
    source: modifier.source || 'event',
  });
}

export function logEvent(game, entry) {
  game.log.push({
    turn: game.turn,
    date: dateLabel(game),
    type: entry.type || 'note',
    severity: entry.severity || 'info',
    text: entry.text,
    nations: entry.nations || [],
  });
  if (game.log.length > 400) game.log.splice(0, game.log.length - 400);
}

export function serialize(game) {
  return JSON.stringify(game);
}

export function deserialize(json) {
  const game = typeof json === 'string' ? JSON.parse(json) : json;
  if (!game || typeof game !== 'object') throw new Error('Save file is not valid JSON.');
  if (game.version !== SAVE_VERSION) {
    throw new Error(`Save file version ${game.version} is not supported (expected ${SAVE_VERSION}).`);
  }
  if (!game.nations || !game.nations[game.playerId]) {
    throw new Error('Save file is missing its player nation.');
  }
  // States invented during the saved run have to be taught to the lookup again
  // before anything asks for their name or flag.
  for (const def of Object.values(game.customNations || {})) registerNation(def);
  return game;
}
