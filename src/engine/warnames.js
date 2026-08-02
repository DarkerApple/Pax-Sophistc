// What a war gets called.
//
// "Russian–Romanian War" is what a database calls a war. People call them after
// the ground they were fought over, the thing they were about, or the season
// they started in — and they number them when it turns out to be the second
// time. A run that produces "the Second Caucasus War" and "the War for the
// Malacca Strait" is a run somebody can tell you about afterwards.
//
// Everything here is derived from facts the engine already has: where the
// fighting is, who outweighs whom, what the declared reason was, and whether
// this has happened before.

import { defOf, livePower, proximity } from './state.js';
import { t, tNation } from '../i18n/index.js';

/**
 * The theatres a war can be fought in, by region. Each region offers several so
 * two wars in the same place a decade apart are not automatically the same war.
 */
/**
 * Each theatre carries the ground it actually names, so the war between China
 * and Taiwan is fought over the Strait rather than over the Amur. The pick is
 * the two nearest to the defender, chosen between at random — near enough to be
 * right, loose enough that the same pair of countries can fight twice without
 * producing the identical name.
 */
const THEATRES = [
  // name, latitude, longitude
  ['the Great Lakes', 45, -84], ['the Rio Grande', 29, -101], ['the Gulf of Mexico', 25, -90],
  ['the Northern Approaches', 62, -60],
  ['the Andes', -20, -68], ['the Southern Cone', -38, -64], ['the Caribbean', 15, -73],
  ['the Amazon', -4, -60],
  ['the Rhine', 50, 7], ['the Low Countries', 51, 5], ['the Alps', 46, 9],
  ['the Bay of Biscay', 45, -4], ['the Western Mediterranean', 39, 6],
  ['the Danube', 45, 21], ['the Carpathians', 48, 24], ['the Baltic', 57, 20],
  ['the Eastern Marches', 52, 28], ['the Black Sea', 43, 34], ['the Aegean', 38, 25],
  ['the Steppe', 50, 62], ['the Caucasus', 42, 45], ['the Urals', 57, 60],
  ['Central Asia', 43, 68],
  ['the Gulf', 27, 51], ['the Levant', 33, 36], ['Mesopotamia', 33, 44], ['the Red Sea', 20, 39],
  ['the Sahel', 15, 5], ['the Horn', 8, 43], ['the Nile', 22, 31], ['the Congo Basin', -2, 22],
  ['the Cape', -30, 24], ['the Maghreb', 32, 3],
  ['the Indus', 28, 70], ['the Himalaya', 30, 84], ['the Bay of Bengal', 16, 88],
  ['the Deccan', 17, 77],
  ['the Yellow Sea', 36, 123], ['the Strait', 24, 119], ['the Amur', 50, 128],
  ['the Peninsula', 38, 127],
  ['the South China Sea', 14, 114], ['the Mekong', 15, 105], ['the Malacca Strait', 3, 100],
  ['the Archipelago', -3, 118],
  ['the Coral Sea', -16, 152], ['the South Pacific', -20, 175], ['the Tasman', -40, 165],
];

/** The two theatres closest to where the fighting will actually be. */
function nearestTheatres(def, n = 2) {
  return [...THEATRES]
    .map(([name, lat, lon]) => {
      let dLon = Math.abs(lon - def.lon);
      if (dLon > 180) dLon = 360 - dLon;
      // Flat enough for a naming heuristic, and longitude narrows toward the poles.
      const scale = Math.cos((def.lat * Math.PI) / 180);
      return { name, d: Math.hypot(lat - def.lat, dLon * scale) };
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((entry) => entry.name);
}

const SEASONS = ['Winter', 'Spring', 'Summer', 'Autumn'];

/** Ordinals for a theatre that has seen this before. */
const ORDINALS = ['', 'Second ', 'Third ', 'Fourth ', 'Fifth ', 'Sixth '];

/**
 * Name a war.
 *
 * @param {object} game
 * @param {string} attackerId
 * @param {string} defenderId
 * @param {{reason?: string, rng?: object}} options
 * @returns {{name: string, theatre: string, shape: string}}
 */
export function nameWar(game, attackerId, defenderId, { reason = '', rng = null } = {}) {
  const attacker = defOf(game, attackerId);
  const defender = defOf(game, defenderId);
  const pick = (list) => (rng ? rng.pick(list) : list[0]);

  // The theatre is the defender's neighbourhood — that is where the fighting
  // will be — unless the two are far apart, in which case it is an expedition
  // and gets named for who went where.
  const near = proximity(attacker, defender) > 0.35;
  const theatre = pick(nearestTheatres(defender));

  const gap = livePower(game, attackerId) / Math.max(1, livePower(game, defenderId));
  const season = SEASONS[game.quarter % 4];

  const candidates = [];

  // A great power falling on a much smaller one is not a war, it is an
  // intervention, and gets called one for a century afterwards.
  // livePower is a compressed index, so a gap of 2.6 on it is already the kind
  // of mismatch nobody afterwards calls a war between two countries.
  if (gap > 2.6) {
    candidates.push({
      weight: 4,
      shape: 'intervention',
      base: t('warname.intervention', 'the {adj} Intervention in {defender}', {
        adj: tNation(attacker, 'adjective'),
        defender: tNation(defender),
      }),
    });
  }

  if (near) {
    candidates.push({ weight: 5, shape: 'theatre', base: t('warname.theatre', '{theatre} War', { theatre: capitalise(theatre) }) });
    candidates.push({ weight: 3, shape: 'contest', base: t('warname.contest', 'War for {theatre}', { theatre }) });
  } else {
    candidates.push({
      weight: 4,
      shape: 'expedition',
      base: t('warname.expedition', '{adj} Expedition', { adj: tNation(attacker, 'adjective') }),
    });
    candidates.push({ weight: 3, shape: 'contest', base: t('warname.contest', 'War for {theatre}', { theatre }) });
  }

  // The declared reason, where it is distinctive enough to name a war after.
  const cause = causeShape(reason);
  if (cause === 'ultimatum') {
    candidates.push({ weight: 4, shape: 'ultimatum', base: t('warname.ultimatum', '{theatre} Ultimatum War', { theatre: capitalise(theatre) }) });
  }
  if (cause === 'escalation') {
    candidates.push({ weight: 3, shape: 'escalation', base: t('warname.escalation', '{season} War of {year}', { season, year: game.year }) });
  }
  if (cause === 'coalition') {
    candidates.push({ weight: 4, shape: 'coalition', base: t('warname.coalition', 'War of the Coalition') });
  }
  if (cause === 'liberation') {
    candidates.push({ weight: 3, shape: 'liberation', base: t('warname.liberation', 'War for {defender}', { defender: tNation(defender) }) });
  }

  // Occasionally the plainest name is the one that sticks.
  candidates.push({ weight: 1, shape: 'season', base: t('warname.season', '{season} War of {year}', { season, year: game.year }) });

  // Weighted so the name that fits best is usually the one that sticks, and the
  // fallback only turns up when nothing else does.
  const chosen = rng ? rng.weighted(candidates, (c) => c.weight ?? 1) : candidates[0];
  const base = chosen.base;

  // Numbering. If this theatre has already had a war of this name, it is the
  // second one — which is how most wars get their number. Names that already
  // carry a year are never numbered: "the Second Winter War of 2026" is not a
  // thing anybody would write.
  const numbered = chosen.shape !== 'season' && chosen.shape !== 'escalation';
  const seen = numbered ? countPrevious(game, base) : 0;
  const ordinal = ORDINALS[Math.min(seen, ORDINALS.length - 1)];
  const name = t('warname.the', 'The {ordinal}{base}', { ordinal, base });

  return { name, theatre, shape: chosen.shape };
}

/** Map the declared reason onto the kind of name it deserves. */
function causeShape(reason) {
  const text = String(reason || '').toLowerCase();
  if (/ultimatum|rejected|demand/.test(text)) return 'ultimatum';
  if (/escalation|rungs/.test(text)) return 'escalation';
  if (/coalition|containment|balance/.test(text)) return 'coalition';
  if (/liberat|restore|intervention/.test(text)) return 'liberation';
  return 'territorial';
}

/**
 * How many wars in this run already carry this name, so the next one can be
 * numbered rather than duplicated.
 */
function countPrevious(game, base) {
  let n = 0;
  for (const war of game.wars) {
    if (!war.baseName) continue;
    if (war.baseName === base) n += 1;
  }
  return n;
}

function capitalise(theatre) {
  // "the Baltic" → "The Baltic" only ever appears mid-name, so strip the
  // article and let the caller's template supply it.
  return theatre.replace(/^the /i, '');
}

/**
 * The name a history book would use, with the years attached. Used by the
 * chronicle and the archive, where the dates are the point.
 */
export function formalName(game, war) {
  const startYear = war.startYear ?? game.year;
  const endYear = war.endedYear ?? (war.active ? null : game.year);
  if (endYear && endYear !== startYear) {
    return t('warname.formalRange', '{name} ({from}–{to})', { name: war.name, from: startYear, to: endYear });
  }
  return t('warname.formal', '{name} ({year})', { name: war.name, year: startYear });
}
