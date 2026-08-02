// Which country to be, and how hard it will be.
//
// Everything on the setup screen used to say how *big* a country was, which is
// not the question a new player is asking. The question is whether the first
// ten quarters will be a game or a scramble — and that turns on solvency,
// unrest, whether the neighbours are hostile, and whether anything nearby is a
// flashpoint. A small, calm, well-liked country is a far gentler run than a
// large one surrounded by people who want its territory.
//
// This module also builds a country from scratch, because "start as somebody
// other than the United States" and "start as somebody who does not exist" are
// the same wish.

import { NATIONS, NATIONS_BY_ID, REGIONS, allKnownNations, playableNations, powerRank } from '../data/nations.js';
import { addNationToScenario } from '../data/scenarios.js';
import { clamp, distanceKm, proximity } from './state.js';
import { t } from '../i18n/index.js';

// ── How hard is this one? ───────────────────────────────────────────────────

/**
 * A start difficulty from 0 (gentle) to 100 (brutal), with the reasons.
 *
 * Reasons are the point: "Hard" tells a player nothing, "hard — two hostile
 * neighbours and a nuclear one" tells them what the run is about.
 *
 * @returns {{score: number, band: object, reasons: Array<{id: string, text: string}>}}
 */
export function startDifficulty(nation) {
  const reasons = [];
  let score = 40;

  // Can it govern itself?
  if (nation.stability < 45) { score += 16; reasons.push(reason('fragile', 'fragile institutions')); }
  else if (nation.stability > 72) { score -= 12; reasons.push(reason('solid', 'solid institutions')); }

  if (nation.unrest > 45) { score += 14; reasons.push(reason('unrest', 'an angry population')); }
  else if (nation.unrest < 22) { score -= 8; reasons.push(reason('calm', 'a calm population')); }

  // Can it pay for anything?
  const wealth = (nation.gdp / Math.max(nation.population, 1)) * 1000;
  if (wealth < 8) { score += 12; reasons.push(reason('poor', 'very little money per head')); }
  else if (wealth > 45) { score -= 10; reasons.push(reason('rich', 'money to work with')); }

  if (nation.gdp < 0.6) { score += 8; reasons.push(reason('small', 'an economy too small to absorb a shock')); }

  // Who is next door?
  const hostile = neighbourhood(nation).filter((other) => tension(nation, other) > 0);
  if (hostile.length >= 3) { score += 16; reasons.push(reason('surrounded', `${hostile.length} difficult neighbours`)); }
  else if (hostile.length >= 1) { score += 8; reasons.push(reason('neighbour', `a difficult neighbour in ${hostile[0].name}`)); }
  else { score -= 8; reasons.push(reason('quiet', 'a quiet neighbourhood')); }

  // Is it standing next to somebody enormous?
  const overshadowing = neighbourhood(nation).filter((other) => powerRank(other) > powerRank(nation) * 1.8);
  if (overshadowing.length) {
    score += 10;
    reasons.push(reason('overshadowed', `${overshadowing[0].name} next door`));
  }

  // Does anybody have a claim on it, or it on them?
  if (FLASHPOINTS.some((pair) => pair.includes(nation.id))) {
    score += 14;
    reasons.push(reason('flashpoint', 'a standing territorial dispute'));
  }

  // Weight and friends both help.
  // Weight cuts both ways, and for the very largest it mostly cuts against you:
  // every government on earth reacts to what you do, the world holds you
  // responsible for its order, and any move you make accrues threat. A new
  // player handed the incumbent superpower is handed fifty relationships.
  if (powerRank(nation) >= 150) {
    score += 6;
    reasons.push(reason('superpower', 'enough weight to absorb mistakes'));
    reasons.push(reason('scrutiny', 'a world that reacts to everything you do'));
  } else if (powerRank(nation) >= 118) {
    score += 2;
    reasons.push(reason('greatPower', 'real weight, and the scrutiny that comes with it'));
  }
  if ((nation.blocs || []).length >= 2) { score -= 8; reasons.push(reason('allied', 'allies from the first quarter')); }
  else if (!(nation.blocs || []).length) { score += 8; reasons.push(reason('alone', 'no alliances at all')); }

  if (nation.nukes > 0) { score -= 6; reasons.push(reason('deterrent', 'a deterrent nobody wants to test')); }

  const value = clamp(Math.round(score));
  return { score: value, band: bandOf(value), reasons: reasons.slice(0, 4) };
}

function reason(id, text) {
  return { id, text: t(`start.reason.${id}`, text) };
}

const BANDS = [
  { ceiling: 30, id: 'gentle', label: 'Gentle start', hint: 'Stable, solvent, few enemies. A good first run.' },
  { ceiling: 45, id: 'steady', label: 'Steady', hint: 'Room to manoeuvre, and something to fix.' },
  { ceiling: 60, id: 'demanding', label: 'Demanding', hint: 'Real problems from the first quarter.' },
  { ceiling: 75, id: 'hard', label: 'Hard', hint: 'You will be reacting for a while before you are choosing.' },
  { ceiling: 101, id: 'brutal', label: 'Brutal', hint: 'For a second or third run. Everything is against you.' },
];

function bandOf(score) {
  return BANDS.find((b) => score < b.ceiling) || BANDS[BANDS.length - 1];
}

/** Countries close enough to matter to this one. */
function neighbourhood(nation) {
  return NATIONS.filter(
    (other) => other.id !== nation.id && (other.region === nation.region || distanceKm(nation, other) < 2600),
  );
}

/** A crude read of whether two countries start out at odds, from the anchors. */
function tension(a, b) {
  const shared = (a.blocs || []).filter((bloc) => (b.blocs || []).includes(bloc)).length;
  if (shared) return 0;
  const opposed =
    ((a.blocs || []).some((x) => WEST.has(x)) && (b.blocs || []).some((x) => EAST.has(x))) ||
    ((a.blocs || []).some((x) => EAST.has(x)) && (b.blocs || []).some((x) => WEST.has(x)));
  return opposed ? 1 : 0;
}

const WEST = new Set(['nato', 'eu', 'usAllied', 'sentinel']);
const EAST = new Set(['csto', 'sco', 'brics']);

/** Pairs the world has an unresolved argument about. */
const FLASHPOINTS = [
  ['chn', 'twn'], ['prk', 'kor'], ['rus', 'ukr'], ['ind', 'pak'],
  ['isr', 'irn'], ['ven', 'col'], ['grc', 'tur'], ['eth', 'egy'],
];

/**
 * The countries a first run should start with, easiest first.
 *
 * Deliberately not "the biggest": a new player handed the United States gets
 * fifty relationships and a world that reacts to everything they do. What they
 * want is somewhere solvent with a quiet border and something obvious to fix.
 */
export function recommendedStarts(limit = 6) {
  return playableNations()
    .map((nation) => ({ nation, ...startDifficulty(nation) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, limit);
}

/** Sort key for the picker, so "easiest first" is one click. */
export function byDifficulty(a, b) {
  return startDifficulty(a).score - startDifficulty(b).score;
}

// ── Building one that does not exist ────────────────────────────────────────

/**
 * The shapes a made-up country can take.
 *
 * Each is a complete statistical identity rather than a slider, because a
 * points-buy screen is a different game from this one — and because "a small
 * rich trading state" is a thing a player can picture, while "influence 62" is
 * not.
 */
export const ARCHETYPES = [
  {
    id: 'trading-port',
    name: 'A small rich trading state',
    blurb: 'Two cities, a container port and a sovereign fund. No army worth the name and no enemies yet.',
    stats: { gdp: 0.9, population: 9, area: 30, military: 22, readiness: 62, tech: 84, stability: 80, influence: 46, unrest: 16, growth: 1.2, nukes: 0 },
    doctrine: 'trader', tags: ['entrepot', 'shipping', 'trade-hub'],
    difficulty: 'gentle',
  },
  {
    id: 'resource-republic',
    name: 'A resource republic',
    blurb: 'Everything under the ground and very little above it. Solvent while the price holds.',
    stats: { gdp: 1.6, population: 34, area: 900, military: 38, readiness: 48, tech: 44, stability: 52, influence: 34, unrest: 42, growth: 1.1, nukes: 0 },
    doctrine: 'developmental', tags: ['oil', 'mining', 'rare-earth'],
    difficulty: 'steady',
  },
  {
    id: 'industrial-middle',
    name: 'An industrial middle power',
    blurb: 'Factories, a real army, a crowded neighbourhood, and an argument with somebody larger.',
    stats: { gdp: 3.4, population: 78, area: 620, military: 58, readiness: 66, tech: 74, stability: 64, influence: 55, unrest: 32, growth: 0.7, nukes: 0 },
    doctrine: 'balancer', tags: ['manufacturing-core', 'export'],
    difficulty: 'steady',
  },
  {
    id: 'young-giant',
    name: 'A young giant',
    blurb: 'Enormous, poor, growing fast, and holding together by arrangement rather than by design.',
    stats: { gdp: 1.9, population: 340, area: 2100, military: 52, readiness: 44, tech: 40, stability: 44, influence: 38, unrest: 52, growth: 1.9, nukes: 0 },
    doctrine: 'developmental', tags: ['demographic-dividend', 'agri'],
    difficulty: 'demanding',
  },
  {
    id: 'fortress-state',
    name: 'A fortress state',
    blurb: 'Conscription, a wire fence and an arsenal. Nobody likes you and nobody has tried you either.',
    stats: { gdp: 1.1, population: 26, area: 380, military: 74, readiness: 84, tech: 66, stability: 58, influence: 24, unrest: 38, growth: 0.4, nukes: 12 },
    doctrine: 'fortress', tags: ['conscription', 'garrison-state'],
    difficulty: 'hard',
  },
  {
    id: 'new-republic',
    name: 'A republic three years old',
    blurb: 'The constitution is new, the borders are argued about, and half the ministries do not have a building yet.',
    stats: { gdp: 0.4, population: 18, area: 240, military: 24, readiness: 34, tech: 38, stability: 34, influence: 18, unrest: 58, growth: 1.6, nukes: 0 },
    doctrine: 'survivalist', tags: ['new-state', 'contested-borders'],
    difficulty: 'brutal',
  },
];

export const ARCHETYPES_BY_ID = Object.fromEntries(ARCHETYPES.map((a) => [a.id, a]));

/** Somewhere on the map that is not already somebody's capital. */
function placeIn(regionId) {
  const region = REGIONS.find((r) => r.id === regionId) || REGIONS[0];
  // Offset from the regional centre, deterministically, until it is not sitting
  // on top of an existing capital.
  for (let ring = 1; ring < 8; ring++) {
    for (const [dLat, dLon] of [[6, 8], [-7, 9], [5, -10], [-6, -8], [9, 2], [-9, -3]]) {
      const lat = clamp(region.lat + dLat * ring * 0.6, -55, 78);
      const lon = ((region.lon + dLon * ring * 0.6 + 540) % 360) - 180;
      const clash = allKnownNations().some((n) => distanceKm(n, { lat, lon }) < 420);
      if (!clash) return { lat: Number(lat.toFixed(2)), lon: Number(lon.toFixed(2)) };
    }
  }
  return { lat: region.lat, lon: region.lon };
}

/**
 * Build a country and register it, so the rest of the engine cannot tell the
 * difference between it and one that shipped with the game.
 *
 * @param {{name: string, adjective?: string, capital?: string, flag?: string,
 *          region: string, archetype: string, government?: string}} spec
 * @returns {object} the registered definition
 */
export function createCountry(spec) {
  const archetype = ARCHETYPES_BY_ID[spec.archetype] || ARCHETYPES[0];
  const name = String(spec.name || '').trim() || 'The Republic';
  const id = uniqueId(name);
  const place = placeIn(spec.region);

  const def = addNationToScenario({
    id,
    name,
    adjective: String(spec.adjective || '').trim() || adjectiviseName(name),
    flag: spec.flag || '🏳️',
    capital: String(spec.capital || '').trim() || `${firstWord(name)} City`,
    lat: place.lat,
    lon: place.lon,
    region: spec.region,
    government: spec.government || 'Republic',
    leaderTitle: spec.leaderTitle || 'President',
    ...archetype.stats,
    blocs: [],
    doctrine: archetype.doctrine,
    tags: [...archetype.tags, 'made-to-order'],
    brief: spec.brief || archetype.blurb,
    custom: true,
    archetype: archetype.id,
  });
  return def;
}

function uniqueId(name) {
  const stem = firstWord(name).toLowerCase().replace(/[^a-z]/g, '').slice(0, 3) || 'own';
  let id = `own-${stem}`;
  let n = 2;
  while (NATIONS_BY_ID[id]) {
    id = `own-${stem}${n}`;
    n += 1;
  }
  return id;
}

function firstWord(name) {
  return name.replace(/^(the|republic of|federation of|kingdom of|united)\s+/i, '').split(/\s+/)[0] || name;
}

function adjectiviseName(name) {
  const core = firstWord(name);
  if (/(ia|a)$/i.test(core)) return `${core}n`;
  if (/(land|mark|stan)$/i.test(core)) return `${core}ic`;
  if (/e$/i.test(core)) return `${core}an`;
  return `${core}ian`;
}

/** Whether a spec would produce something usable, and what is wrong if not. */
export function validateCountry(spec) {
  const problems = [];
  const name = String(spec?.name || '').trim();
  if (name.length < 2) problems.push(t('own.needName', 'It needs a name.'));
  if (name.length > 34) problems.push(t('own.nameLong', 'That name is too long for the map.'));
  if (!REGIONS.some((r) => r.id === spec?.region)) problems.push(t('own.needRegion', 'It needs somewhere to be.'));
  if (!ARCHETYPES_BY_ID[spec?.archetype]) problems.push(t('own.needShape', 'It needs a shape.'));
  return { ok: problems.length === 0, problems };
}
