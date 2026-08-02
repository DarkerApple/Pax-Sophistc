// Who can actually get there.
//
// Wars were fought as though every belligerent were standing on the same field.
// A coalition assembled against a European aggressor counted Brazil's army at
// full weight, and when the coalition won, the ground could be handed to
// whichever member happened to be strongest — a country with no route to the
// theatre, no bases within three thousand kilometres, and no navy to get there
// with. It produced maps where Argentina administered a slice of Siberia.
//
// Reach fixes both ends of that. It is one number, 0–1, for what share of a
// country's force it can put onto another country's ground:
//
//   • a shared land border is reach 1 — you walk there
//   • distance eats it, at a rate set by what you can project with
//   • a navy, an expeditionary tradition and overseas bases push the horizon out
//   • an ally who borders the target and has given you access is a staging base,
//     which is what basing agreements are *for*
//
// Everything that moves territory now goes through it, and so does the war
// score itself: a war is decided by the force each side can bring to that
// theatre, not by the force it owns.

import { NATIONS_BY_ID } from '../data/nations.js';
import { blocsOf, combatPower, defOf, getRelation, isSovereign } from './state.js';
import { centroidOf, neighboursOf } from './territory.js';
import { alliesOf, hasTreaty } from './treaties.js';

const EARTH_R = 6371;

/** Below this a country simply cannot conduct operations there. */
export const MIN_REACH = 0.18;
/** At or above this, the theatre is effectively next door. */
export const NEAR_REACH = 0.75;

/**
 * How far a country can put a division, in kilometres, before its reach halves.
 *
 * A conscript army with no lift is a border force whatever its size; a navy and
 * a base network are the difference between a regional power and a global one.
 * This is the *scale* of the decay, not a hard limit — nothing is ever zero.
 */
export function projection(game, id) {
  const state = game.nations[id];
  const def = defOf(game, id);
  if (!state || !def) return 400;

  const tags = def.tags || [];
  const has = (re) => tags.some((tag) => re.test(tag));

  // Strategic lift is bought, not willed: it scales with the military budget a
  // large economy can carry, not with headcount.
  let km = 380 + Math.pow(Math.max(state.military, 1), 1.25) * 5.2;
  km *= 0.55 + state.readiness / 130;
  km *= 0.7 + state.tech / 180;

  if (has(/blue-water-navy/)) km *= 3.1;
  if (has(/global-bases|us-basing|al-udeid/)) km *= 1.9;
  if (has(/expeditionary|aukus|five-eyes/)) km *= 1.45;
  if (has(/shipping-fleet|entrepot|malacca|straits?$/)) km *= 1.2;
  if (has(/africa-footprint|belt-and-road/)) km *= 1.3;
  // A doctrine of standing on your own border is not a doctrine of going
  // anywhere else.
  if (has(/landlocked/)) km *= 0.62;
  if (has(/total-defence|conscription|reservist-army|militia-army|neutral/)) km *= 0.72;
  if (def.doctrine === 'fortress' || def.doctrine === 'isolationist') km *= 0.75;
  if (def.doctrine === 'hegemon') km *= 1.25;

  // Nobody projects power while their own house is burning.
  km *= 0.6 + state.stability / 250;
  return Math.max(180, km);
}

/** Great-circle kilometres between two points. */
function haversine(a, b) {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const dφ = φ2 - φ1;
  const dλ = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Where a country's mass actually is now, not where its capital was in 2026. */
function seatOf(game, id) {
  return centroidOf(game, id) || NATIONS_BY_ID[id] || null;
}

// Neighbour lists are walked over the whole grid; a war asks for them several
// times a quarter and they only change when the map does.
const borderCache = new WeakMap();

function bordersOf(game, id) {
  let byId = borderCache.get(game);
  const stamp = game.territory?.revision || 0;
  if (!byId || byId.stamp !== stamp) {
    byId = { stamp, map: new Map() };
    borderCache.set(game, byId);
  }
  if (!byId.map.has(id)) byId.map.set(id, new Set(neighboursOf(game, id)));
  return byId.map.get(id);
}

/** Do these two share a land border right now? */
export function adjacent(game, a, b) {
  return bordersOf(game, a).has(b);
}

/**
 * Somebody who borders the target and would let this country stage from their
 * soil. Basing and transit is the treaty that exists for exactly this; a full
 * alliance implies it; a bloc partner in a military organisation usually
 * shrugs and opens the airfield.
 *
 * @returns {{id: string, kind: string} | null} the best staging partner
 */
export function stagingFor(game, actorId, targetId) {
  let best = null;
  for (const ally of alliesOf(game, actorId)) {
    if (!isSovereign(game, ally.id)) continue;
    if (ally.id === targetId) continue;
    if (!adjacent(game, ally.id, targetId)) continue;
    const grade = hasTreaty(game, actorId, ally.id, 'access') ? 1
      : ally.kind === 'alliance' ? 0.85
        : ally.kind === 'umbrella' ? 0.7
          : 0.5;
    if (!best || grade > best.grade) best = { id: ally.id, kind: ally.kind, grade };
  }

  // Blocs are not treaties, but a military bloc member on the target's border
  // is still an airfield you can probably use.
  if (!best || best.grade < 0.6) {
    for (const blocId of blocsOf(game, actorId)) {
      for (const otherId of Object.keys(game.nations)) {
        if (otherId === actorId || otherId === targetId) continue;
        if (!isSovereign(game, otherId)) continue;
        if (!blocsOf(game, otherId).includes(blocId)) continue;
        if (!adjacent(game, otherId, targetId)) continue;
        if (getRelation(game, actorId, otherId) < 20) continue;
        if (!best || best.grade < 0.55) best = { id: otherId, kind: 'bloc', grade: 0.55 };
      }
    }
  }
  return best;
}

/**
 * What share of its force `actorId` can bring to bear on `targetId`'s ground.
 *
 * @returns {{value: number, km: number, why: string, via: string|null}}
 */
export function reachDetail(game, actorId, targetId) {
  if (actorId === targetId) return { value: 1, km: 0, why: 'home', via: null };
  if (adjacent(game, actorId, targetId)) {
    return { value: 1, km: 0, why: 'border', via: null };
  }

  const from = seatOf(game, actorId);
  const to = seatOf(game, targetId);
  if (!from || !to) return { value: MIN_REACH, km: Infinity, why: 'nowhere', via: null };

  let km = haversine(from, to);
  let why = 'distance';
  let via = null;

  // Staging shortens the trip to the distance from the staging partner, which
  // for a bordering ally is nearly nothing.
  const staging = stagingFor(game, actorId, targetId);
  if (staging) {
    const base = seatOf(game, staging.id);
    if (base) {
      const staged = haversine(from, base) * (1 - staging.grade * 0.82);
      if (staged < km) {
        km = staged;
        why = 'staging';
        via = staging.id;
      }
    }
  }

  const scale = projection(game, actorId);
  // Halves every `scale` kilometres, so a country three horizons away is at an
  // eighth of its strength rather than at nothing — expeditions are possible,
  // they are just expensive and small.
  const value = Math.max(MIN_REACH * 0.4, Math.pow(0.5, km / scale));
  return { value: Math.min(1, value), km: Math.round(km), why, via };
}

/** The number on its own, which is what most callers want. */
export function reach(game, actorId, targetId) {
  return reachDetail(game, actorId, targetId).value;
}

/** Can this country conduct ground operations there at all? */
export function canReach(game, actorId, targetId) {
  return reach(game, actorId, targetId) >= MIN_REACH;
}

// ── Wars ────────────────────────────────────────────────────────────────────

/**
 * Where a war is being fought: the ground of whoever is being invaded, or of
 * the largest belligerent if nobody has moved yet.
 *
 * A war has a theatre even when it has several fronts — this is the centre of
 * gravity, the place a distant coalition partner would have to reach.
 */
export function theatreOf(game, war) {
  if (!war) return null;
  // Whoever has ground under occupation is where the fighting is.
  for (const [, from] of war.occupied || []) {
    if (isSovereign(game, from)) return from;
  }
  const defenders = war.defenders.filter((id) => isSovereign(game, id));
  if (defenders.length) return defenders[0];
  return war.attackers[0] || null;
}

/**
 * What a belligerent is actually worth in this war.
 *
 * Defending your own soil is worth all of it. Everybody else contributes what
 * they can get there — which is the difference between a war and a list of
 * armies.
 */
export function theatreWeight(game, id, war) {
  const theatre = theatreOf(game, war);
  if (!theatre || theatre === id) return 1;
  // Anyone who shares a border with the theatre is in the war whether they
  // wanted to be or not.
  if (adjacent(game, id, theatre)) return 1;
  const value = reach(game, id, theatre);
  // A partial commitment is still more than the raw curve suggests: allies send
  // squadrons and money before they send divisions.
  return Math.min(1, 0.22 + value * 0.85);
}

/** Combat power a side can put into this theatre, rather than power it owns. */
export function theatrePower(game, ids, war) {
  return ids.reduce((sum, id) => sum + combatPower(game, id) * theatreWeight(game, id, war), 0);
}

/**
 * Of the countries on the winning side, who is in a position to take and hold
 * this ground — best first. Anybody who cannot get there is not a candidate,
 * whatever their army is worth at home.
 */
export function occupiersFor(game, candidates, targetId) {
  return candidates
    .filter((id) => id !== targetId && isSovereign(game, id))
    .map((id) => ({ id, reach: reach(game, id, targetId), power: combatPower(game, id) }))
    .filter((entry) => entry.reach >= MIN_REACH)
    .sort((a, b) => b.power * b.reach - a.power * a.reach);
}

/**
 * A country's reach to everywhere that matters, for the interface.
 * @returns {Array<{id: string, value: number, km: number, why: string, via: string|null}>}
 */
export function reachReport(game, id, ids) {
  return ids
    .filter((other) => other !== id && isSovereign(game, other))
    .map((other) => ({ id: other, ...reachDetail(game, id, other) }))
    .sort((a, b) => b.value - a.value);
}
